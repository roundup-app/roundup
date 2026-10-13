"""L109: parse test-reachable fixed waits and reconcile immutable base locations."""
import argparse
from dataclasses import dataclass
import hashlib
import json
import posixpath
import re
from pathlib import Path
import subprocess

from tree_sitter import Language, Parser
import tree_sitter_rust
import tree_sitter_typescript

GRAMMARS = {
    '.rs': Language(tree_sitter_rust.language()),
    '.ts': Language(tree_sitter_typescript.language_typescript()),
    '.tsx': Language(tree_sitter_typescript.language_tsx()),
    '.mts': Language(tree_sitter_typescript.language_typescript()),
    '.cts': Language(tree_sitter_typescript.language_typescript()),
}
FUNCTIONS = {'function_item', 'function_declaration', 'arrow_function', 'function_expression', 'method_definition'}
LOOPS = {'while_expression', 'loop_expression', 'for_expression', 'while_statement', 'for_statement', 'do_statement'}


def walk(node):
    yield node
    for child in node.named_children:
        yield from walk(child)


def value(node):
    return node.text.decode() if node else ''


def ancestors(node):
    while node.parent:
        node = node.parent
        yield node


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


@dataclass
class Source:
    path: str
    data: bytes

    def __post_init__(self):
        self.tree = Parser(GRAMMARS[Path(self.path).suffix]).parse(self.data)
        self.nodes = list(walk(self.tree.root_node))
        if self.path.endswith('.rs'):
            # Rust macro bodies are token trees, not expressions. Parse a second,
            # position-preserving view with invocation names masked so calls inside
            # select!/assert!/custom macros remain visible to the same analysis.
            masked = bytearray(self.data)
            for macro in self.nodes:
                if macro.type == 'macro_invocation':
                    tokens = next((child for child in macro.named_children if child.type == 'token_tree'), None)
                    if tokens:
                        for index in range(macro.start_byte, tokens.start_byte):
                            if masked[index] not in (10, 13):
                                masked[index] = 32
            self.macro_tree = Parser(GRAMMARS['.rs']).parse(bytes(masked))
            seen = {(node.start_byte, node.end_byte) for node in self.nodes if node.type == 'call_expression'}
            self.nodes += [node for node in walk(self.macro_tree.root_node)
                           if node.type == 'call_expression' and (node.start_byte, node.end_byte) not in seen]
        self.bindings = {}
        for node in self.nodes:
            if node.type in {'variable_declarator', 'let_declaration', 'const_item', 'static_item'}:
                name = value(node.child_by_field_name('name') or node.child_by_field_name('pattern'))
                scope = next((parent for parent in ancestors(node) if parent.type in {'statement_block', 'block', 'declaration_list', 'program', 'source_file'}), self.tree.root_node)
                self.bindings.setdefault(name, []).append((scope, node.child_by_field_name('value')))
            if node.type in {'required_parameter', 'optional_parameter', 'parameter'}:
                name = value(node.child_by_field_name('pattern') or node.child_by_field_name('name'))
                function = next((parent for parent in ancestors(node) if parent.type in FUNCTIONS), None)
                if name and function:
                    self.bindings.setdefault(name, []).append((function, None))
        self.aliases = {}
        self.alias_records = {}
        self.imports = {}
        self.test_names = {'test', 'it', 'describe', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'}
        for node in self.nodes:
            if node.type in {'import_statement', 'export_statement'} and node.child_by_field_name('source'):
                origin = value(node.child_by_field_name('source')).strip('\'"')
                for child in walk(node):
                    if child.type in {'import_specifier', 'export_specifier'}:
                        name = value(child.child_by_field_name('name'))
                        alias = value(child.child_by_field_name('alias')) or name
                        self.imports['@default' if alias == 'default' else alias] = (origin, '@default' if name == 'default' else name)
                        if origin in {'vitest', 'bun:test', 'node:test', '@playwright/test'} and name in {'test', 'it', 'describe'}:
                            self.test_names.add(alias)
                        if origin in {'timers', 'node:timers', 'timers/promises', 'node:timers/promises'}:
                            self.add_alias(alias, origin + '::' + name, node)
                    if child.type == 'import_clause':
                        for binding in child.named_children:
                            if binding.type == 'identifier':
                                self.imports[value(binding)] = (origin, '@default')
                                if origin in {'timers', 'node:timers', 'timers/promises', 'node:timers/promises'}:
                                    self.add_alias(value(binding), origin, node)
                    if child.type == 'namespace_import':
                        alias = value(child.named_children[-1])
                        self.add_alias(alias, origin, node)
                        self.imports[alias] = (origin, '*')
            if node.type == 'use_declaration':
                self.rust_import(node.child_by_field_name('argument'))
        # Local bindings to imported or qualified timer functions retain their identity.
        resolved_bindings = set()
        changed = True
        while changed:
            changed = False
            for node in self.nodes:
                if node.start_byte in resolved_bindings or node.type not in {'variable_declarator', 'let_declaration'}:
                    continue
                binding = node.child_by_field_name('value')
                if not binding or binding.type not in {'identifier', 'member_expression', 'scoped_identifier', 'field_expression'}:
                    continue
                name = value(node.child_by_field_name('name') or node.child_by_field_name('pattern'))
                target = self.resolve(value(binding), node)
                if (target in {'setTimeout', 'std::thread::sleep', 'tokio::time::sleep'} or 'timers' in target) and self.aliases.get(name) != target:
                    self.add_alias(name, target, node)
                    resolved_bindings.add(node.start_byte)
                    changed = True

    def binding(self, name, reference=None):
        choices = [(scope, binding) for scope, binding in self.bindings.get(name, [])
                   if (scope.type in {'program', 'source_file'} if reference is None
                       else scope.start_byte <= reference.start_byte < scope.end_byte)]
        if not choices:
            return None
        choices = [(scope, binding) for scope, binding in choices
                   if not (reference and binding and binding.parent.type == 'let_declaration'
                           and scope.type == 'block' and binding.start_byte > reference.start_byte)]
        if not choices:
            return None
        return min(choices, key=lambda item: (item[0].end_byte - item[0].start_byte,
                                             -item[1].start_byte if item[1] else 0))[1]

    def rust_import(self, node, prefix=''):
        if not node:
            return
        if node.type == 'scoped_use_list':
            prefix += value(node.child_by_field_name('path')) + '::'
            self.rust_import(node.child_by_field_name('list'), prefix)
        elif node.type == 'use_list':
            for child in node.named_children:
                self.rust_import(child, prefix)
        elif node.type == 'use_wildcard':
            path = prefix + value(node.named_children[0])
            if path in {'tokio::time', 'std::thread'}:
                self.add_alias('sleep', path + '::sleep', node)
        elif node.type == 'use_as_clause':
            self.add_alias(value(node.child_by_field_name('alias')), prefix + value(node.child_by_field_name('path')), node)
        else:
            target = prefix + value(node)
            if target.endswith('::self'):
                target = target[:-6]
            self.add_alias(target.split('::')[-1], target, node)

    def add_alias(self, name, target, declaration):
        scope = next((parent for parent in ancestors(declaration)
                      if parent.type in {'statement_block', 'block', 'program', 'source_file', 'declaration_list'}), self.tree.root_node)
        self.aliases[name] = target
        self.alias_records.setdefault(name, {})[declaration.start_byte] = (scope, target)

    def resolve(self, name, reference=None):
        target = name.replace('.', '::')
        seen = set()
        while True:
            head, separator, tail = target.partition('::')
            if head in seen:
                return target
            seen.add(head)
            records = [(scope, alias) for scope, alias in self.alias_records.get(head, {}).values()
                       if (scope.type in {'program', 'source_file'} if reference is None
                           else scope.start_byte <= reference.start_byte < scope.end_byte)]
            if not records:
                return target
            _, alias = min(records, key=lambda item: item[0].end_byte - item[0].start_byte)
            target = alias + (separator + tail if separator else '')

    def function(self, node):
        return next((parent for parent in ancestors(node) if parent.type in FUNCTIONS), None)

    def name(self, node):
        name = node.child_by_field_name('name')
        holder = node.parent
        if holder and holder.type == 'pair':
            name = holder.child_by_field_name('key')
            holder = holder.parent
        if name:
            parts = [value(name).strip('\'\"')]
            while holder and holder.type in {'object', 'class_body'}:
                parent = holder.parent
                if parent.type in {'variable_declarator', 'class_declaration'}:
                    return value(parent.child_by_field_name('name')) + '.' + '.'.join(parts)
                if parent.type == 'pair':
                    parts.insert(0, value(parent.child_by_field_name('key')).strip('\'\"'))
                    holder = parent.parent
                else:
                    break
            return '.'.join(parts)
        if holder and holder.type == 'variable_declarator':
            return value(holder.child_by_field_name('name'))
        return '@' + str(node.start_byte)

    def is_test(self, node=None):
        parts = Path(self.path).parts
        if 'tests' in parts or '.test.' in self.path or '.spec.' in self.path or self.path.endswith('_test.rs'):
            return True
        if not node:
            return False
        for parent in [node, *ancestors(node)]:
            if parent.type == 'call_expression' and value(parent.child_by_field_name('function')).split('.')[0] in self.test_names:
                return True
            sibling = parent.prev_named_sibling
            while sibling and sibling.type == 'attribute_item':
                text = value(sibling)
                if 'test' in text and ('#[test' in text or '::test' in text or 'cfg(test)' in text):
                    return True
                sibling = sibling.prev_named_sibling
        return False


def state_poll(node):
    """A loop must exit on observed state, not merely an elapsed-time budget."""
    for loop in ancestors(node):
        if loop.type not in LOOPS:
            continue
        for branch in walk(loop):
            if branch.type not in {'if_expression', 'if_statement', 'match_expression'}:
                continue
            condition = branch.child_by_field_name('condition') or branch.child_by_field_name('value')
            text = value(condition)
            if condition and any(child.type in {'integer_literal', 'number'} for child in walk(condition)):
                continue
            if not text or any(term in text.lower() for term in ('elapsed', 'deadline', 'instant::', 'date.now', 'timeout', 'attempt', 'retries')):
                continue
            if any(child.type in {'break_expression', 'return_expression', 'break_statement', 'return_statement'} for child in walk(branch)):
                return True
        condition = loop.child_by_field_name('condition')
        if condition and not any(child.type in {'integer_literal', 'number'} for child in walk(condition)) and value(condition) not in {'true', 'false'} and not any(term in value(condition).lower() for term in ('elapsed', 'deadline', 'timeout', 'attempt', 'retries')):
            return True
    return False


def names_awaited_state(text):
    text = text.lower().strip('\'\"`')
    if re.search(r'(awaiting|waiting for|did not receive|never received)\s+\S+', text):
        return True
    state, separator, _ = text.partition(' timed out')
    return bool(separator and state.strip() and state.strip() not in {
        'test', 'timer', 'wait', 'call', 'request', 'operation', 'it', 'this'})


def rust_select_guard(source, node):
    for macro in source.nodes:
        if macro.type != 'macro_invocation' or value(macro.child_by_field_name('macro')) != 'tokio::select':
            continue
        if not macro.start_byte <= node.start_byte < macro.end_byte:
            continue
        tokens = next(child for child in macro.named_children if child.type == 'token_tree')
        arms = [[]]
        for child in tokens.children[1:-1]:
            if child.type == ',':
                arms.append([])
            else:
                arms[-1].append(child)
        if len([arm for arm in arms if arm]) < 2:
            continue
        for arm in arms:
            arrow = next((index for index, token in enumerate(arm) if token.type == '=>'), None)
            if arrow is None or not any(token.start_byte <= node.start_byte < token.end_byte for token in arm[:arrow]):
                continue
            handler = [child for token in arm[arrow + 1:] for child in walk(token)]
            diagnostics = [value(child).lower().strip('\'\"') for child in handler if child.type == 'string_literal']
            if any(value(child) in {'panic', 'bail'} and child.next_sibling and child.next_sibling.type == '!' for child in handler) and any(names_awaited_state(text) for text in diagnostics):
                return True
    return False


def allowed(source, node, target):
    if state_poll(node) or (source.path.endswith('.rs') and rust_select_guard(source, node)):
        return True
    function = source.function(node)
    context = value(function) if function else value(node.parent)
    if function:
        sibling = function.prev_named_sibling
        while sibling and sibling.type == 'attribute_item':
            context += value(sibling)
            sibling = sibling.prev_named_sibling
    clock_nodes = [call for call in walk(function) if call.type == 'call_expression'] if function else []
    clock_calls = {value(call.child_by_field_name('function')) for call in clock_nodes}
    fake_clock = any(call.endswith('.useFakeTimers') for call in clock_calls)
    clock_advanced = any(call.split('.')[-1].startswith(('advanceTimers', 'runAllTimers')) for call in clock_calls)
    rust_advanced = any(source.resolve(value(call.child_by_field_name('function')), call).endswith('::advance') for call in clock_nodes)
    # Only timers controlled by the fake clock qualify, not real Promise delays.
    in_promise = any(parent.type == 'new_expression' and value(parent.child_by_field_name('constructor')) == 'Promise' for parent in ancestors(node))
    if target in {'setTimeout', 'window::setTimeout', 'globalThis::setTimeout'} and not in_promise and fake_clock and clock_advanced:
        return True
    if target.endswith('::sleep') and 'start_paused' in context and rust_advanced and node.parent.type != 'await_expression':
        return True
    if target.endswith('::sleep') and not source.is_test(node):
        for parent in ancestors(node):
            if parent.type != 'call_expression' or not source.resolve(value(parent.child_by_field_name('function')), parent).endswith('::spawn'):
                continue
            actions = [source.resolve(value(call.child_by_field_name('function')), call)
                       for call in walk(parent) if call.type == 'call_expression']
            if any(action != target and not action.endswith('::spawn') and not action.startswith(('Duration::', 'std::time::Duration::')) for action in actions):
                return True
    if target.endswith('setTimeout'):
        arguments = node.child_by_field_name('arguments')
        callback = arguments.named_children[0] if arguments and arguments.named_children else None
        if callback and callback.type in FUNCTIONS:
            # A hang guard's failure, rather than an unrelated comment/string,
            # must carry the awaited-state diagnostic.
            for failure in walk(callback):
                rejecting = failure.type == 'call_expression' and value(failure.child_by_field_name('function')).split('.')[-1] == 'reject'
                if failure.type != 'throw_statement' and not rejecting:
                    continue
                diagnostics = [value(child).lower().strip('\'\"') for child in walk(failure) if child.type in {'string', 'template_string'}]
                if any(names_awaited_state(diagnostic) for diagnostic in diagnostics):
                    return True
            # Timers executing product behavior are subjects, not Promise-based delays.
            if not source.is_test(node) and not any(parent.type == 'new_expression' and value(parent.child_by_field_name('constructor')) == 'Promise' for parent in ancestors(node)):
                return True
    return False


def helper_candidates(sources, path, name, seen=None, reference=None):
    seen = set() if seen is None else seen
    if (path, name) in seen or path not in sources:
        return []
    seen.add((path, name))
    import_name, _, member = name.partition('.')
    imported = sources[path].imports.get(import_name)
    if not imported:
        binding = sources[path].binding(import_name, reference)
        if binding and binding.type in {'identifier', 'member_expression'}:
            target = value(binding) + ('.' + member if member else '')
            return helper_candidates(sources, path, target, seen, binding)
        if binding and binding.type == 'new_expression' and member:
            target = value(binding.child_by_field_name('constructor')) + '.' + member
            return helper_candidates(sources, path, target, seen, binding)
        return [(path, name)]
    origin, target = imported
    if not origin.startswith('.'):
        return []
    if target == '*':
        target = member
    elif member:
        target += '.' + member
    destination = posixpath.normpath((Path(path).parent / origin).as_posix())
    if Path(destination).suffix in {'.js', '.jsx', '.mjs', '.cjs'}:
        destination = str(Path(destination).with_suffix(''))
    candidates = []
    for suffix in ('', '.ts', '.tsx', '.mts', '.cts', '/index.ts', '/index.tsx', '/index.mts', '/index.cts'):
        candidates += helper_candidates(sources, destination + suffix, target, seen)
    return candidates


def binding_evidence(sources, path, node, seen=None):
    """Track value bindings, not callback bodies or application computations."""
    seen = set() if seen is None else seen
    evidence = set()
    pending = [node]
    while pending:
        child = pending.pop()
        if child.type in FUNCTIONS:
            continue
        pending += child.named_children
        if child.type not in {'identifier', 'type_identifier'}:
            continue
        name = value(child)
        if (path, name) in seen:
            continue
        seen.add((path, name))
        source = sources[path]
        if name in source.aliases:
            evidence.add(f'{path}:{name}={source.resolve(name, child)}')
        candidates = [(path, name)]
        if name in source.imports:
            candidates += helper_candidates(sources, path, name)
        for destination, imported in candidates:
            binding = sources[destination].binding(imported, child if destination == path else None)
            if not binding or any(part.type in FUNCTIONS or part.type == 'await_expression'
                                  or part.type.startswith('jsx_') for part in walk(binding)):
                continue
            evidence.add(f'{destination}:{imported}={value(binding)}')
            evidence |= binding_evidence(sources, destination, binding, seen)
    return evidence


def exclusively_polled(key, reverse_calls, seen=None):
    seen = set() if seen is None else seen
    if key in seen:
        return False
    seen = seen | {key}
    calls = reverse_calls.get(key, {})
    return bool(calls) and all(state_poll(call) or exclusively_polled(caller, reverse_calls, seen)
                               for caller, call in calls.values())


def wait_context(sources, source, node, reverse_calls):
    evidence = binding_evidence(sources, source.path, node)
    pending = [(source.path, source.name(parent)) for parent in ancestors(node) if parent.type in FUNCTIONS]
    seen = set()
    while pending:
        key = pending.pop()
        if key in seen:
            continue
        seen.add(key)
        for caller, call in reverse_calls.get(key, {}).values():
            evidence.add(f'{caller[0]}:{call.start_point}:{value(call)}')
            evidence |= binding_evidence(sources, caller[0], call)
            pending.append(caller)
    return hashlib.sha256('\n'.join(sorted(evidence)).encode()).hexdigest()


def inventory(sources):
    functions = {}
    reached = set()
    for source in sources.values():
        for node in source.nodes:
            if node.type in FUNCTIONS:
                key = (source.path, source.name(node))
                functions[key] = node
                if node.parent and node.parent.type == 'export_statement' and any(child.type == 'default' for child in node.parent.children):
                    functions[(source.path, '@default')] = node
                if source.is_test(node):
                    reached.add(key)
    calls_by_function = {}
    for source in sources.values():
        for node in source.nodes:
            if node.type == 'call_expression':
                for parent in ancestors(node):
                    if parent.type in FUNCTIONS:
                        calls_by_function.setdefault((source.path, source.name(parent)), []).append(node)
    rust_names = {}
    for key in functions:
        if key[0].endswith('.rs'):
            rust_names.setdefault(key[1], []).append(key)
    # Each reachable helper is visited once, including nested callbacks.
    reverse_calls = {}
    pending = list(reached)
    while pending:
        path, name = pending.pop()
        source = sources[path]
        for call in calls_by_function.get((path, name), []):
            if call.type != 'call_expression':
                continue
            callee = value(call.child_by_field_name('function'))
            candidates = helper_candidates(sources, path, callee, reference=call)
            if Path(path).suffix == '.rs' and not source.resolve(callee, call).startswith(('std::', 'tokio::', 'core::')):
                matches = rust_names.get(source.resolve(callee, call).split('::')[-1], [])
                if len(matches) == 1:
                    candidates += matches
                else:
                    qualified = source.resolve(callee, call).split('::')
                    if len(qualified) > 1:
                        module = qualified[-2]
                        candidates += [key for key in matches if Path(key[0]).stem == module or Path(key[0]).parent.name == module]
            for candidate in candidates:
                if candidate in functions:
                    canonical = (candidate[0], sources[candidate[0]].name(functions[candidate]))
                    reverse_calls.setdefault(canonical, {})[(path, call.start_byte, name)] = ((path, name), call)
                    if canonical not in reached:
                        reached.add(canonical)
                        pending.append(canonical)
    rows = []
    for source in sources.values():
        for node in source.nodes:
            if node.type != 'call_expression':
                continue
            function = source.function(node)
            if not source.is_test(node) and not any((source.path, source.name(parent)) in reached for parent in ancestors(node) if parent.type in FUNCTIONS):
                continue
            target = source.resolve(value(node.child_by_field_name('function')), node)
            if target not in {'setTimeout', 'window::setTimeout', 'globalThis::setTimeout', 'std::thread::sleep', 'thread::sleep', 'tokio::time::sleep', 'Bun::sleep', 'node:timers/promises::setTimeout', 'timers/promises::setTimeout', 'node:timers::setTimeout', 'timers::setTimeout'} and not target.endswith('::waitForTimeout'):
                continue
            parents = [(source.path, source.name(parent)) for parent in ancestors(node) if parent.type in FUNCTIONS]
            if allowed(source, node, target) or (parents and exclusively_polled(parents[-1], reverse_calls)):
                continue
            expression = value(node)
            context = wait_context(sources, source, node, reverse_calls)
            rows.append({'file': source.path, 'line': node.start_point.row + 1,
                         'column': node.start_point.column + 1, 'expression': expression,
                         'test': source.name(function) if function else '<test module>',
                         'awaited_state': 'missing', 'context': context,
                         'id': hashlib.sha256(f'{source.path}:{node.start_point}:{expression}:{context}'.encode()).hexdigest()})
    return sorted(rows, key=lambda row: (row['file'], row['line'], row['column']))


def load_sources(root, revision=None):
    paths = git(root, 'ls-tree', '-r', '--name-only', '-z', revision).decode().split('\0') if revision else git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').decode().split('\0')
    result = {}
    for path in sorted(set(paths)):
        if Path(path).suffix not in GRAMMARS or path.startswith(('tools/oxlint/anti-slop/vendor/', '.agents/skills/', '.claude/skills/')):
            continue
        data = git(root, 'show', f'{revision}:{path}') if revision else (root / path).read_bytes() if (root / path).is_file() else None
        if data is not None:
            result[path] = Source(path, data)
    return result


def reconcile(base_rows, rows):
    """Only an unchanged line at its original location can inherit a base exemption."""
    exemptions = {(row['file'], row['line'], row['column'], row['expression'], row['context']): row['id'] for row in base_rows}
    inherited = {}
    failures = []
    for row in rows:
        key = (row['file'], row['line'], row['column'], row['expression'], row['context'])
        if key in exemptions:
            inherited[row['id']] = exemptions[key]
        else:
            failures.append(row)
    return inherited, failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--language', choices=['rust', 'typescript'])
    parser.add_argument('--inventory', action='store_true')
    parser.add_argument('--retire', action='store_true')
    args = parser.parse_args()
    baseline_path = args.root / 'loop/fixed-wait-baseline.json'
    baseline = json.loads(baseline_path.read_text()) if baseline_path.exists() else {'base_sha': git(args.root, 'rev-parse', 'HEAD').decode().strip(), 'active': []}
    base_sources = load_sources(args.root, baseline['base_sha'])
    base_rows = inventory(base_sources)
    snapshot_path = args.root / 'loop/fixed-wait-inventory.json'
    if snapshot_path.exists() and json.loads(snapshot_path.read_text()) != {
            'format': 1, 'base_sha': baseline['base_sha'], 'waits': base_rows}:
        parser.error('Care inventory must contain the complete immutable base inventory')
    if not set(baseline['active']) <= {row['id'] for row in base_rows}:
        parser.error('baseline contains locations absent from the immutable base inventory')
    # Retirement is monotone across committed baselines as well as this worktree.
    ceiling = None
    revisions = git(args.root, 'log', '--reverse', '--format=%H',
                    'HEAD', '--', 'loop/fixed-wait-baseline.json').decode().splitlines()
    for revision in revisions:
        previous = json.loads(git(args.root, 'show', revision + ':loop/fixed-wait-baseline.json'))
        if previous['base_sha'] != baseline['base_sha'] or (ceiling is not None and not set(previous['active']) <= ceiling):
            parser.error('committed baseline grew or changed its implementation base')
        ceiling = set(previous['active'])
    if ceiling is not None and not set(baseline['active']) <= ceiling:
        parser.error('baseline cannot restore retired locations')
    current_sources = load_sources(args.root)
    parse_failures = []
    for path, source in current_sources.items():
        before = base_sources.get(path)
        existing_errors = {value(node) for node in before.nodes if node.type == 'ERROR' or node.is_missing} if before else set()
        for node in walk(source.tree.root_node):
            if (node.type == 'ERROR' or node.is_missing) and value(node) not in existing_errors:
                parse_failures.append(f'{path}:{node.start_point.row + 1}: L109 cannot parse changed source; awaited state missing')
    rows = inventory(current_sources)
    inherited, failures = reconcile(base_rows, rows)
    active = set(baseline['active'])
    failures += [row for row in rows if row['id'] in inherited and inherited[row['id']] not in active]
    retired = active - set(inherited.values())
    if args.retire:
        baseline['active'] = sorted(active - retired)
        baseline_path.write_text(json.dumps(baseline, indent=2) + '\n')
        retired = set()
    if args.inventory:
        print(json.dumps({'format': 1, 'base_sha': baseline['base_sha'], 'waits': rows}, indent=2))
        return 0
    selected = [row for row in failures if not args.language or (row['file'].endswith('.rs') == (args.language == 'rust'))]
    for failure in parse_failures:
        print(failure)
    for row in selected:
        print(f"{row['file']}:{row['line']}:{row['column']}: L109 fixed delay; awaited state missing: {row['expression']}")
    for row in base_rows:
        if row['id'] in retired:
            print(f"{row['file']}:{row['line']}: L109 retire removed baseline wait; awaited state missing at base")
    if retired:
        print('L109 removed waits must retire their baseline entries: run loop/fixed-wait.sh --retire')
    return 1 if selected or retired or parse_failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
