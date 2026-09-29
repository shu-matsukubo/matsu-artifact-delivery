import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../mcp/', import.meta.url);
const metadataPath = new URL('node-runtime.json', root);
const archivePath = new URL('node-win-x64.zip', root);
const licensePath = new URL('NODE_RUNTIME_LICENSES.txt', root);
const args = process.argv.slice(2);

type Metadata = {
  version: string;
  platform: 'win32-x64';
  archive: string;
  archiveSha256: string;
  source: string;
  sourceSha256: string;
  checksums: string;
  license: string;
  licenseSource: string;
  licenseSha256: string;
};

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipNode(executable: Buffer): Buffer {
  const name = Buffer.from('node.exe');
  const compressed = deflateRawSync(executable, { level: 9 });
  const crc = crc32(executable);
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(executable.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(executable.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

function unzipNode(archive: Buffer): Buffer {
  if (archive.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid runtime ZIP local header.');
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  const name = archive.subarray(30, 30 + nameLength).toString('utf8');
  if (name !== 'node.exe') throw new Error(`Unexpected runtime ZIP entry: ${name}`);
  const start = 30 + nameLength + extraLength;
  const compressedSize = archive.readUInt32LE(18);
  const executable = inflateRawSync(archive.subarray(start, start + compressedSize));
  if (archive.readUInt32LE(14) !== crc32(executable)) throw new Error('Runtime ZIP CRC32 mismatch.');
  if (archive.readUInt32LE(22) !== executable.length) throw new Error('Runtime ZIP size mismatch.');
  return executable;
}

async function verify(): Promise<void> {
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Metadata;
  const archive = await readFile(archivePath);
  const executable = unzipNode(archive);
  const license = await readFile(licensePath);
  const actual = {
    archiveSha256: sha256(archive),
    sourceSha256: sha256(executable),
    licenseSha256: sha256(license),
  };
  for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
    if (actual[key] !== metadata[key])
      throw new Error(`${key} mismatch: expected ${metadata[key]}, got ${actual[key]}`);
  }
  console.log(`Node.js ${metadata.version} runtime archive, upstream binary checksum, and license are verified.`);
}

async function update(version: string): Promise<void> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a Node.js version such as 22.23.2.');
  const checksums = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
  const source = `https://nodejs.org/dist/v${version}/win-x64/node.exe`;
  const licenseSource = `https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`;
  const [checksumText, executable, license] = await Promise.all([
    fetch(checksums).then(async (response) => {
      if (!response.ok) throw new Error(`Could not fetch Node.js checksums: ${response.status}`);
      return response.text();
    }),
    fetch(source).then(async (response) => {
      if (!response.ok) throw new Error(`Could not fetch Node.js runtime: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }),
    fetch(licenseSource).then(async (response) => {
      if (!response.ok) throw new Error(`Could not fetch Node.js license: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }),
  ]);
  const line = checksumText.split(/\r?\n/).find((entry) => entry.endsWith('  win-x64/node.exe'));
  const expectedSourceSha256 = line?.match(/^([a-f\d]{64})\s/)?.[1];
  if (!expectedSourceSha256 || sha256(executable) !== expectedSourceSha256) {
    throw new Error('Downloaded node.exe does not match the official Node.js SHASUMS256.txt checksum.');
  }
  const archive = zipNode(executable);
  const metadata: Metadata = {
    version,
    platform: 'win32-x64',
    archive: 'node-win-x64.zip',
    archiveSha256: sha256(archive),
    source,
    sourceSha256: expectedSourceSha256,
    checksums,
    license: 'NODE_RUNTIME_LICENSES.txt',
    licenseSource,
    licenseSha256: sha256(license),
  };
  await writeFile(archivePath, archive);
  await writeFile(licensePath, license);
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await verify();
}

if (args[0] === '--update' && args.length === 2) {
  await update(args[1]!);
} else if ((args.length === 0 || args[0] === '--verify') && args.length <= 1) {
  await verify();
} else {
  throw new Error(`Usage: node ${fileURLToPath(import.meta.url)} [--verify | --update VERSION]`);
}
