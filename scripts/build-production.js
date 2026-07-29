const fs = require('fs/promises');
const path = require('path');
const { minify } = require('terser');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'public');
const outputDir = path.join(root, '.production-public');

const forbiddenPatterns = [
  { label: 'Supabase Secret 키', pattern: /sb_secret_[A-Za-z0-9_-]+/g },
  { label: '서비스 롤 키 변수', pattern: /SUPABASE_SERVICE_ROLE_KEY/g },
  { label: '비밀키 변수', pattern: /\b(?:JWT_SECRET|PRIVATE_KEY|ADMIN_PASSWORD)\b/g }
];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

async function assertNoFrontendSecrets(files) {
  const textFiles = files.filter((file) => /\.(?:html|js|css|json|webmanifest)$/i.test(file));
  const findings = [];
  for (const file of textFiles) {
    const source = await fs.readFile(file, 'utf8');
    for (const rule of forbiddenPatterns) {
      if (rule.pattern.test(source)) {
        findings.push(`${path.relative(root, file)}: ${rule.label}`);
      }
      rule.pattern.lastIndex = 0;
    }
  }
  if (findings.length) {
    throw new Error(`프론트엔드 비밀정보 검사를 통과하지 못했습니다.\n${findings.join('\n')}`);
  }
}

async function build() {
  const sourceFiles = await walk(sourceDir);
  await assertNoFrontendSecrets(sourceFiles);

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.cp(sourceDir, outputDir, { recursive: true });

  const outputFiles = await walk(outputDir);
  const javascriptFiles = outputFiles.filter((file) => file.endsWith('.js'));

  for (const file of javascriptFiles) {
    const source = await fs.readFile(file, 'utf8');
    const result = await minify(source, {
      compress: { passes: 2, drop_console: true },
      mangle: true,
      format: { comments: false },
      sourceMap: false
    });
    if (!result.code) throw new Error(`${path.relative(root, file)} 압축 결과가 비어 있습니다.`);
    await fs.writeFile(file, result.code, 'utf8');
  }

  console.log(`운영용 화면 생성 완료: ${javascriptFiles.length}개 JS 압축, 소스맵 없음`);
}

build().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
