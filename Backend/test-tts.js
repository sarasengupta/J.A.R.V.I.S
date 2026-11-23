const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const fs = require('fs');

async function test() {
  const tts = new MsEdgeTTS();
  await tts.setMetadata('en-GB-RyanNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream('Good evening, Sara. All quantum telemetry subroutines are online, Ma\'am.');
  const writeStream = fs.createWriteStream('test_output.mp3');
  audioStream.pipe(writeStream);
  writeStream.on('finish', () => {
    console.log('SUCCESS: Generated test_output.mp3, size:', fs.statSync('test_output.mp3').size);
    process.exit(0);
  });
}

test().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
