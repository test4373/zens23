/* eslint no-console:off */
const { EbmlStreamDecoder } = require('./lib');

const ebmlDecoder = new EbmlStreamDecoder();
const counts = {};

require('fs')
  .createReadStream('media/test.webm')
  .pipe(ebmlDecoder)
  .on('data', (tag) => {
    const id = tag.id;
    if (!counts[id]) {
      counts[id] = 0;
    }
    counts[id] += 1;
  })
  .on('finish', () => console.log(counts));
