import pos from 'natural/lib/natural/brill_pos_tagger/index.js';

const lexicon = new pos.Lexicon('EN', 'NN', 'NNP');

const ruleSet = new pos.RuleSet('EN');

const tagger = new pos.BrillPOSTagger(lexicon, ruleSet);

const tags = tokens => {
  const first = tokens[0];

  if (!first || !lexicon.tagWord(first.toLowerCase()).includes('VB')) return tagger.tag(tokens).taggedWords;
  // Natural accepts a lexicon at this seam. Sentence-initial imperatives
  // select its known base-verb reading before the Brill rules run.
  const imperative = new pos.BrillPOSTagger({ tagWord: word => word === first ? ['VB'] : lexicon.tagWord(word) }, ruleSet);

  return imperative.tag(tokens).taggedWords;
};

const words = new Intl.Segmenter('en', { granularity: 'word' });

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

const wordList = text => [...words.segment(text.replace(/⟦[^⟧]*⟧/g, ' someone '))].flatMap(each => each.isWordLike ? [each.segment] : []);

export function languageProblems(text, kind, banned) {
  const problems = [];
  const authored = text.replace(/⟦[^⟧]*⟧/g, '');


  for (const term of banned) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?:s|es)?(?![\\p{L}\\p{N}_])`, 'iu').test(authored)) problems.push('vocabulary');
  }

  if (/\b(drafts?|retained work|revisions?|unfinished rail work)\b/i.test(authored)) problems.push('recovery-name');

  if (kind === 'label') {
    if (wordList(text).length > 3) problems.push('label-length');

    // Explanatory prose cannot opt out of grammar by claiming to be a label.
    if (/[a-z][.!](?:\s|$)/i.test(authored)) problems.push('prose-as-label');
  } else {
    const parts = [...sentences.segment(text)];

    if (!parts.length) problems.push('unanalysable-prose');

    for (const part of parts) {
      if (!/[a-z]/i.test(part.segment.replace(/⟦[^⟧]*⟧/g, ''))) continue;
      const tokens = wordList(part.segment);

      if (tokens.length > 12) problems.push('sentence-length');

      if (!tokens.length || !tags(tokens).some(({ tag }) => /^(VB|VBD|VBP|VBZ)$/.test(tag))) problems.push('fragment');
    }
  }

  return [...new Set(problems)];
}

export function avoidedWords(glossary) {
  const table = glossary.split('\n').filter(line => line.startsWith('|') && !line.startsWith('| Code term')).map(line => line.split('|')[3]?.trim() ?? '').filter(cell => cell && cell !== '—');
  const qualifications = text => text.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').replace(/[`_]/g, '').split(',').map(term => term.trim().replace(/\.$/, '')).filter(Boolean);

  return [...new Set([...table, ...[...glossary.matchAll(/^_Avoid_:\s*(.+)$/gm)].map(match => match[1])].flatMap(qualifications).filter(term => term !== '—' && term !== '---').concat(['Daemon', 'MCP', 'session', 'revision', 'retained', 'acceptance', 'Door', 'Shelf', 'Handoff']))];
}
