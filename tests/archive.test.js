const assert = require("node:assert/strict");
const fflate = require("../src/vendor/fflate.js");

function buildStreamingZip(entries) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const zip = new fflate.Zip((error, data, final) => {
      if (error) {
        reject(error);
        return;
      }
      if (data?.length) chunks.push(Buffer.from(data));
      if (final) resolve(new Uint8Array(Buffer.concat(chunks)));
    });

    entries.forEach(({ name, value, compress }) => {
      const entry = compress
        ? new fflate.ZipDeflate(name, { level: 6 })
        : new fflate.ZipPassThrough(name);
      zip.add(entry);
      entry.push(fflate.strToU8(value), true);
    });
    zip.end();
  });
}

(async () => {
  const archive = await buildStreamingZip([
    { name: "Архітектурна консультація.md", value: "# Чат\n\n[Файл](./input/вхід.txt)", compress: true },
    { name: "Архітектурна консультація.json", value: '{"schemaVersion":1}', compress: true },
    { name: "input/вхід.txt", value: "вхідні дані", compress: false },
    { name: "output/результат.txt", value: "готовий документ", compress: false }
  ]);
  const unpacked = fflate.unzipSync(archive);

  assert.equal(
    fflate.strFromU8(unpacked["Архітектурна консультація.md"]),
    "# Чат\n\n[Файл](./input/вхід.txt)"
  );
  assert.equal(fflate.strFromU8(unpacked["Архітектурна консультація.json"]), '{"schemaVersion":1}');
  assert.equal(fflate.strFromU8(unpacked["input/вхід.txt"]), "вхідні дані");
  assert.equal(fflate.strFromU8(unpacked["output/результат.txt"]), "готовий документ");
  console.log("archive tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
