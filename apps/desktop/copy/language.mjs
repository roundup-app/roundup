import pos from 'natural/lib/natural/brill_pos_tagger/index.js';

const tagger = new pos.BrillPOSTagger(new pos.Lexicon('EN', 'NN', 'NNP'), new pos.RuleSet('EN'));

const words = new Intl.Segmenter('en', { granularity: 'word' });

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

const segments = text => [...words.segment(text.replaceAll('␟', 'item'))].flatMap(part => part.isWordLike ? [part.segment] : []);

/** Extract named Avoid terms; parenthesized explanations never become forbidden words. */
function bannedWords(glossary) {
  const terms = [...glossary.matchAll(/^_Avoid_:\s*(.*)$/gm)].flatMap(match => match[1].split(';')[0].split(',').map(term => term.replace(/\(.*$/, '').trim().replaceAll('_', '')));

  return [...new Set([...terms.filter(Boolean), 'Daemon', 'MCP', 'session', 'revision', 'retained', 'acceptance'])];
}

/** Grammar is deterministic and lint-only; supplied runtime contents stay opaque. */
export function language(text, glossary) {
  const diagnostics = [];
  const normalized = text.toLowerCase();

  for (const term of bannedWords(glossary)) {
    const phrase = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?:s|es)?(?![\\p{L}\\p{N}])`, 'u').test(normalized)) diagnostics.push({ rule: 'vocabulary', text: term });
  }

  if (/\b(drafts?|retained work|revisions?|unfinished rail work)\b/i.test(text)) diagnostics.push({ rule: 'recovery', text });
  const prose = /[.!;]/.test(text.replace(/\d\.\d/g, ''));

  if (!prose) {
    if (segments(text).length > 3) diagnostics.push({ rule: 'length', text });

    return diagnostics;
  }

  for (const sentence of sentences.segment(text)) {
    const tokens = segments(sentence.segment);

    if (tokens.length > 12) diagnostics.push({ rule: 'length', text: sentence.segment });

    if (!tokens.length || !tagger.tag(tokens).taggedWords.some(word => /^(VB|VBD|VBP|VBZ)$/.test(word.tag))) diagnostics.push({ rule: 'fragment', text: sentence.segment });
  }

  return diagnostics;
}
