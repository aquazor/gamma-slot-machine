const { execSync } = require('child_process');
const fs = require('fs');

const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe';
const EXE = 'build/Gamma Slot Machine.exe';
const BLOB = 'build/sea-prep.blob';

const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function run(command) {
  console.log(`\n> ${command}\n`);

  execSync(command, {
    stdio: 'inherit',
    shell: true,
  });
}

try {
  console.log('\n=== Building Gamma Slot Machine ===\n');

  // 1. Bundle server
  run('node build-server.cjs');

  // 2. Generate SEA config
  run('node generate-sea-config.cjs');

  // 3. Generate SEA blob
  run('node --experimental-sea-config sea-config.json');

  // 4. Copy Node executable
  if (fs.existsSync(EXE)) {
    fs.unlinkSync(EXE);
  }

  fs.copyFileSync(NODE_EXE, EXE);

  console.log(`Copied Node executable to: ${EXE}`);

  // 5. Inject SEA blob
  run(`npx postject "${EXE}" NODE_SEA_BLOB "${BLOB}" --sentinel-fuse ${SENTINEL}`);

  console.log('\n========================================');
  console.log(' BUILD SUCCESSFUL');
  console.log('========================================');
  console.log(`\n${EXE}\n`);
} catch (error) {
  console.error('\n========================================');
  console.error(' BUILD FAILED');
  console.error('========================================\n');

  process.exit(1);
}
