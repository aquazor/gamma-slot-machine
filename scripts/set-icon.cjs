const { rcedit } = require('rcedit');

console.log('Starting rcedit...');
console.log('Before rcedit');

rcedit('build/Gamma Slot Machine.exe', {
  icon: 'app.ico',
})
  .then(() => {
    console.log('Icon changed successfully!');
  })
  .catch((error) => {
    console.error('rcedit failed:', error);
    process.exit(1);
  });

console.log('rcedit called');
