const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe';

const EXE = path.resolve('build/Gamma Slot Machine.exe');
const ICON_EXE = path.resolve('build/Gamma Slot Machine-icon.exe');
const BLOB = path.resolve('build/sea-prep.blob');

const ICON = path.resolve('app.ico');

const RESOURCE_HACKER = 'C:\\Program Files (x86)\\Resource Hacker\\ResourceHacker.exe';

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

  // ========================================
  // 1. Bundle server
  // ========================================

  run('node build-server.cjs');

  // ========================================
  // 2. Generate SEA config
  // ========================================

  run('node generate-sea-config.cjs');

  // ========================================
  // 3. Generate SEA blob
  // ========================================

  run('node --experimental-sea-config sea-config.json');

  // ========================================
  // 4. Copy Node executable
  // ========================================

  if (fs.existsSync(EXE)) {
    fs.unlinkSync(EXE);
  }

  fs.copyFileSync(NODE_EXE, EXE);

  console.log(`Copied Node executable to: ${EXE}`);

  // ========================================
  // 5. Inject SEA blob
  // ========================================

  run(`npx postject "${EXE}" NODE_SEA_BLOB "${BLOB}" --sentinel-fuse ${SENTINEL}`);

  // ========================================
  // 6. Change application icon
  // ========================================

  if (!fs.existsSync(ICON)) {
    throw new Error(`Icon file not found: ${ICON}`);
  }

  if (!fs.existsSync(RESOURCE_HACKER)) {
    throw new Error(`Resource Hacker not found: ${RESOURCE_HACKER}`);
  }

  // Remove old temporary file if it exists
  if (fs.existsSync(ICON_EXE)) {
    fs.unlinkSync(ICON_EXE);
  }

  console.log('\nChanging application icon...\n');

  run(
    `"${RESOURCE_HACKER}" ` +
      `-open "${EXE}" ` +
      `-save "${ICON_EXE}" ` +
      `-action addoverwrite ` +
      `-res "${ICON}" ` +
      `-mask ICONGROUP,MAINICON,`,
  );

  // ========================================
  // 7. Replace original EXE
  // ========================================

  if (!fs.existsSync(ICON_EXE)) {
    throw new Error('Resource Hacker did not create the icon EXE.');
  }

  fs.unlinkSync(EXE);
  fs.renameSync(ICON_EXE, EXE);

  console.log('\nIcon applied successfully.');

  // ========================================
  // SUCCESS
  // ========================================

  console.log('\n========================================');
  console.log(' BUILD SUCCESSFUL');
  console.log('========================================');
  console.log(`\n${EXE}\n`);
} catch (error) {
  console.error('\n========================================');
  console.error(' BUILD FAILED');
  console.error('========================================\n');

  console.error(error);

  process.exit(1);
}
