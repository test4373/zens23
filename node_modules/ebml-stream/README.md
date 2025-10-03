[EBML][EBML] stands for Extensible Binary Meta-Language and is somewhat of a
binary version of XML. It's used for container formats like [WebM][webm] or
[MKV][mkv].

## Note

This library was rewritten from version `3.0.0` of the existing [npm ebml][npm-ebml] package.  The rewrite was performed mainly to enable modification of tags during streaming. (At the time of this writing, the referenced library required a deep understanding of both the inner workings of the package and ebml to update the required properties correctly between decoding and encoding binary data).  As part of the rewrite, the project was converted to use Typescript and to provide a uniform API for decoding and encoding EBML.

# Install

Install via NPM:

```bash
npm install --save ebml-stream
```

# Usage

The `EbmlStreamDecoder` class is implemented as a [Node Transform Stream][node-stream-transform].
The input to this transform function should be binary EBML, provided in a [Node Buffer object][node-buffer-object]. The output of the stream is a series of `EbmlTag` objects.

These `EbmlTag` objects can then be modified as desired (encryption, compression, etc.) and reencoded using the `EbmlStreamEncoder` class.  This class also extends [Node Transform Stream][node-stream-transform].  The input to this transform must be `EbmlTag` objects.  The output of this transform function is binary EBML (in a [Buffer][node-buffer-object]) that can be written to disk or streamed to a client.

> Note: When using `EbmlStreamDecoder` or `EbmlStreamEncoder` in a pipeline, make sure to set `readableObjectMode=true` and `writableObjectMode=true` for connected `Transform` streams.

# EbmlTag Object

`EbmlTag` is an abstract class that specifies the basic data structure of an element in EBML.  Creating new EBML tags can be done via the `EbmlTagFactory.create` method.

```ts
abstract class EbmlTag {
    // The id of the EBML tag.  In most documentation this number is in hexadecimal format
    id: number;
    // The data type of the EBML tag
    type: EbmlElementType;
    // The position of this EBML tag.  Currently, one of "Start", "Content", or "End"
    position: EbmlTagPosition;
    // The total size of the tag in bytes
    size: number;

    // Public abstract method that is overwritten in derived classes to encode tag content (everything after the "size" VInt)
    protected abstract encodeContent(): Buffer;
    // Public abstract method that is overwritten in derived classes to parse tag content from a raw Buffer
    public abstract parseContent(content: Buffer): void;
    // Public method that writes the current tag as binary EBML.  Depends on the `encodeContent` abstract method being correctly implemented by subclasses.
    public encode(): Buffer;
}
```

There are two base 'flavors' of `EbmlTag`:

  * `EbmlMasterTag` is a tag that contains one or more child tags.  This tag always has a `type` of Master (`'m'`).  When streaming, the `EbmlStreamDecoder` will first emit a master tag with position as "Start", then all child tags, then the master tag with position as "End".
  * `EbmlDataTag` is a tag that only contains data.  This tag always has a position of "Content".

## EbmlMasterTag Details

```ts
class EbmlMasterTag extends EbmlTag {
    Children: EbmlTag[];
}
```

This tag always has a type of Master (`'m'`).  When streaming, this tag is only ever emitted with a position of "Start" or "End", and the tag's `Children` property will be empty (children of the tag will be emitted by the stream between the "Start" and "End" chunks).  When encoding, if you wish to submit the tag by itself without individually pushing "Start", children, and "End" tags, you can set the tag's position to "Content". This will allow you to set the `Children` property in memory and write the tag once, rather than pushing each child separately.

## EbmlDataTag Details

```ts
class EbmlDataTag extends EbmlTag {
    data: any;
}
```

This tag can contain data of any one of the defined [Matroska][mkv] data types:

  * UnsignedInt(`u`): Some of these are UIDs, coded as 128-bit numbers.
  * Integer(`i`): signed integer.
  * Float(`f`): IEEE-754 floating point number.
  * String(`s`): printable ASCII text string.
  * UTF8(`8`): printable utf-8 Unicode text string.
  * Date(`d`): a 64-bit signed timestamp, in nanoseconds after (or before) `2001-01-01T00:00UTC`.
  * Binary(`b`): binary data, otherwise uninterpreted.

Regardless of the type of data stored, it can be retrieved from the `data` property of the class.

There are currently two known subtypes of `EbmlDataTag` that are treated as special cases:

  * [`Block`][mkv-block]
  * [`SimpleBlock`][mkv-sblock]

### Block

```ts
class Block extends EbmlDataTag {
    payload: Buffer;
    track: number;
    value: number;
    invisible: boolean;
    lacing: BlockLacing;
}
```

These properties are specific to the [Block][mkv-block] element as defined by [Matroska][mkv].

### SimpleBlock

```ts
class SimpleBlock extends Block {
    discardable: boolean;
    keyframe: boolean; 
}
```

These properties are specific to the [SimpleBlock][mkv-sblock] element as defined by [Matroska][mkv].

# Examples

This example reads a media file into memory and decodes it.

```js
const fs = require('fs');
const { EbmlStreamDecoder } = require('ebml-stream');

const decoder = new EbmlStreamDecoder();

decoder.on('data', chunk => console.log(chunk));

fs.readFile('media/test.webm', (err, data) => {
    if (err) {
        throw err;
    }
    decoder.write(data);
});
```

This example does the same thing, but by piping the file stream into the decoder (a Transform stream).  It also keeps track of the number of times each tag appears in the file.

```js
const fs = require('fs');
const { EbmlStreamDecoder } = require('ebml-stream');

const ebmlDecoder = new EbmlStreamDecoder();
const tagCounts = {};

fs.createReadStream('media/test.webm')
    .pipe(ebmlDecoder)
    .on('data', (tag) => {
        if (!tagCounts[tag.id]) {
            tagCounts[tag.id] = 0;
        }
        tagCounts[tag.id]++;
    })
    .on('finish', () => console.log(tagCounts));
```

This example rips the audio from a webm and stores the result in a new file.  The transform function in this example is rather advanced - an explanation follows the code.

```js
const fs = require('fs');
const { EbmlStreamDecoder, EbmlStreamEncoder, EbmlTagId } = require('ebml-stream');
const { Transform } = require('stream');

const ebmlDecoder = new EbmlStreamDecoder({
    bufferTagIds: [
        EbmlTagId.TrackEntry
    ]
});
const ebmlEncoder = new EbmlStreamEncoder();

let strippedTracks = {};

fs.createReadStream('media/audiosample.webm')
    .pipe(ebmlDecoder)
    .pipe(new Transform({
        transform(chunk, enc, cb) {
            if(chunk.id === EbmlTagId.TrackEntry) {
                if(chunk.Children.find(c => c.id === EbmlTagId.TrackType).data != 2) {
                    strippedTracks[chunk.Children.find(c => c.id === EbmlTagId.TrackNumber).data] = true;
                    chunk = null;
                }
            } else if(chunk.id === EbmlTagId.Block || chunk.id === EbmlTagId.SimpleBlock) {
                if(strippedTracks[chunk.track]) {
                    chunk = null;
                }
            }            
            cb(null, chunk);
        },
        readableObjectMode: true,
        writableObjectMode: true
    }))
    .pipe(ebmlEncoder)
    .pipe(fs.createWriteStream('media/audioout.webm'));
```

In the above example, we (1) read a webm file from disk, (2) decode the webm file into an `EbmlTag` stream, (3) rip any tracks that are not audio out from the `EbmlTag` stream, (4) convert the `EbmlTag` stream back into binary, and (5) write the binary back to disk.

Steps 1, 2, 4, and 5 are rather straightforward (look into the other examples or read more about [Node Stream Pipe][node-stream-pipe] functions for help), but step 3 (where we create the new `Transform` object) will likely require additional explanation.

> __Step 3 Breakdown__
> 
> First, notice that we pass an additional option into the `EbmlStreamDecoder` constructor named `bufferTagIds`.  This option tells the decoder which `EbmlMasterTag` objects should be fully parsed into "Content" tags before being emitted rather than the standard "Start" and "End" tags.  This greatly simplifies our transform logic, as we don't have to maintain an internal buffer for the "TrackEntry" tag that we are interested in processing.  Any tag ids that resolve to an `EbmlDataTag` will have no effect if they are supplied in this paramater.
> Second, we create the `Transform` object with the `readableObjectMode` and `writableObjectMode` properties set to `true`. Without those properties set, Node will throw an error because this stream works with objects rather than string or binary data.
> 
> Now, looking at the logic of the transform function itself -
> * First, we inspect the chunk to see if it is a "TrackEntry" tag.  If so, we look through its Children to find the "TrackType" for this track.  If the type is not 2 (audio), we add the track number to the `strippedTracks` object and set the chunk to `null` so that it is not passed through to the encoder.
> * If the chunk is not a "TrackEntry", we then check if it is a "Block" or a "SimpleBlock".  If true, we check the trock number of the block.  If the track is being stripped from the file, we set the chunk to `null` so that it will not be passed to the encoder.
> * The final line of the transform function merely passes the current chunk data through to the encoder so that it can be written to the output file.
>


# State of this project

Parsing and writing should both work. If something is broken, please create [an issue][new-issue].

Any additional feature requests can also be submitted as [an issue][new-issue].

If any well-known tags have special parsing/encoding rules or data structures that aren't implemented, pull requests are welcome!

# License

[MIT](./LICENSE)

# Contributors

(in alphabetical order)

* [Austin Blake](https://github.com/austinleroy)
* [Chris Price](https://github.com/chrisprice)
* [Davy Van Deursen](https://github.com/dvdeurse)
* [Ed Markowski](https://github.com/siphontv)
* [Jonathan Sifuentes](https://github.com/jayands)
* [Manuel Wiedenmann](https://github.com/fsmanuel)
* [Mark Schmale](https://github.com/themasch)
* [Mathias Buus](https://github.com/mafintosh)
* [Max Ogden](https://github.com/maxogden)
* [Oliver Jones](https://github.com/OllieJones)
* [Oliver Walzer](https://github.com/owcd)

[EBML]: http://ebml.sourceforge.net/
[npm-ebml]: https://www.npmjs.com/package/ebml
[new-issue]: https://github.com/austinleroy/ebml-stream/issues/new
[MDN-Uint8Array]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array
[node-stream-pipe]: https://nodejs.org/api/stream.html#stream_choose_one_api_style
[node-stream-transform]: https://nodejs.org/api/stream.html#stream_class_stream_transform
[node-buffer-object]:https://nodejs.org/api/buffer.html
[mkv]: http://www.matroska.org/technical/specs/index.html
[mkv-block]: https://www.matroska.org/technical/specs/index.html#block_structure
[mkv-sblock]: https://www.matroska.org/technical/specs/index.html#simpleblock_structure
[webm]: https://www.webmproject.org/
