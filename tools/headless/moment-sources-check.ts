/**
 * Unit check of the moment source data (src/moments/sources.ts): the validation rules, what may be embedded, the embed
 * URLs, and every record's sources. No browser, no network.
 *
 *   npx tsx tools/headless/moment-sources-check.ts
 *
 * Exits non-zero on any failure.
 */
import { ALL_MOMENTS } from '../../src/moments/data';
import {
  hasSources,
  momentAuthorLine,
  momentExcerpt,
  sourceDomain,
  sourceEmbed,
  validateMomentSources,
  validateSource,
  visibleSources,
  youtubeEmbedUrl,
} from '../../src/moments/sources';
import type { Moment, MomentSource } from '../../src/moments/types';

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

const video: MomentSource = {
  kind: 'video',
  title: 'Resmî kayıt',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  embed: { kind: 'youtube', videoId: 'abcdefghijk', startSec: 12, endSec: 80 },
  attribution: 'Hak sahibinin kanalı',
  licence: 'YouTube standart lisansı',
  approved: true,
};
const image: MomentSource = {
  kind: 'image',
  title: 'Portre',
  url: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
  embed: { kind: 'image', src: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg', width: 800, height: 600 },
  attribution: 'Bir fotoğrafçı',
  licence: 'kamu malı',
  approved: true,
};
const link: MomentSource = { kind: 'text', title: 'Metin', url: 'https://tr.wikisource.org/wiki/Ornek', approved: false };

console.log('1. validation');
check(validateSource(video).length === 0, `a complete approved video validates (${validateSource(video).join('; ')})`);
check(validateSource(image).length === 0, `a complete approved image validates (${validateSource(image).join('; ')})`);
check(validateSource(link).length === 0, 'an unapproved link needs no attribution or licence');
check(validateSource({ ...video, attribution: undefined }).some((e) => e.includes('attribution')), 'approved without attribution is rejected');
check(validateSource({ ...video, licence: ' ' }).some((e) => e.includes('licence')), 'approved without licence is rejected');
check(validateSource({ ...link, url: 'http://example.org/x' }).length > 0, 'a plain http URL is rejected');
check(validateSource({ ...link, url: 'javascript:alert(1)' }).length > 0, 'a javascript: URL is rejected');
check(validateSource({ ...link, url: 'tr.wikisource.org/wiki/x' }).length > 0, 'a relative URL is rejected');
check(validateSource({ ...link, title: '' }).length > 0, 'a missing title is rejected');
check(validateSource({ ...link, kind: 'book' as MomentSource['kind'] }).length > 0, 'an unknown kind is rejected');
for (const id of ['short', 'abcdefghijkl', 'abc def ghi', 'abcdefghij"']) {
  check(validateSource({ ...video, embed: { kind: 'youtube', videoId: id } }).some((e) => e.includes('video id')), `video id "${id}" is rejected`);
}
check(validateSource({ ...video, embed: { kind: 'youtube', videoId: 'abcdefghijk', startSec: 30, endSec: 10 } }).length > 0, 'end before start is rejected');
check(validateSource({ ...video, embed: { kind: 'youtube', videoId: 'abcdefghijk', startSec: -1 } }).length > 0, 'negative seconds are rejected');
check(validateSource({ ...video, embed: { kind: 'youtube', videoId: 'abcdefghijk', startSec: 1.5 } }).length > 0, 'fractional seconds are rejected');
check(validateSource({ ...video, kind: 'link' }).length > 0, 'a YouTube embed on a non-video item is rejected');
check(validateSource({ ...image, embed: { kind: 'image', src: 'https://example.org/a.jpg', width: 10, height: 10 } }).length > 0, 'an image from a host outside the allow list is rejected');
check(validateSource({ ...image, embed: { kind: 'image', src: 'https://upload.wikimedia.org/a.jpg', width: 0, height: 10 } }).length > 0, 'an image without its size is rejected');

console.log('2. what is embedded');
check(sourceEmbed(video) === video.embed && sourceEmbed(image) === image.embed, 'approved, valid items are embedded');
check(sourceEmbed({ ...video, approved: false }) === null, 'an unapproved video is never embedded');
check(sourceEmbed({ ...image, approved: false }) === null, 'an unapproved image is never embedded');
check(sourceEmbed({ ...video, licence: undefined }) === null, 'an approved item that fails validation is not embedded');
check(sourceEmbed({ ...video, embed: { kind: 'youtube', videoId: 'bad' } }) === null, 'an invalid video id is not embedded');
check(sourceEmbed(link) === null, 'a link has nothing to embed');
const url = youtubeEmbedUrl({ kind: 'youtube', videoId: 'abcdefghijk', startSec: 12, endSec: 80 });
check(url.startsWith('https://www.youtube-nocookie.com/embed/abcdefghijk?'), `the player is youtube-nocookie (${url})`);
check(url.includes('start=12') && url.includes('end=80') && !url.includes('autoplay'), 'start / end are passed, no autoplay');
check(sourceDomain('https://www.youtube.com/watch?v=x') === 'youtube.com' && sourceDomain('https://tr.wikisource.org/wiki/A') === 'tr.wikisource.org', 'domains shown without www.');

const m = ALL_MOMENTS[0];
const withSources: Moment = { ...m, sources: [link, { ...link, url: 'ftp://x' }, video] };
check(visibleSources(withSources).length === 2, 'items with a broken URL are not listed');
check(!hasSources({ ...m, sources: undefined }) && hasSources(withSources), 'hasSources');

console.log('3. the records');
for (const moment of ALL_MOMENTS) {
  const errors = validateMomentSources(moment);
  check(errors.length === 0, `${moment.id}: sources valid (${errors.join('; ')})`);
}
const poem = ALL_MOMENTS.find((x) => x.id === 'orhan-veli-istanbulu-dinliyorum');
check(!!poem && hasSources(poem), 'the Orhan Veli poem has sources');
if (poem) {
  const text = poem.sources?.find((s) => s.kind === 'text');
  check(!!text && sourceDomain(text.url) === 'tr.wikisource.org', 'its text links to Vikikaynak');
  check((poem.sources ?? []).every((s) => sourceEmbed(s) === null || s.approved), 'nothing unapproved is embedded');
  check(momentExcerpt(poem).length === poem.content.subtitles.length && momentExcerpt(poem)[0].startsWith("İstanbul'u dinliyorum"), 'the excerpt is the subtitle lines in order');
  check(momentAuthorLine(poem).includes('Orhan Veli'), `author line (${momentAuthorLine(poem)})`);
}

console.log(`moment-sources-check: ${checks} checks, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
