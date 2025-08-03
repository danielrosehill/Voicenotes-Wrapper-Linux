const { generateIcons } = require('electron-icon-maker');

const options = {
  source: './build/icon.svg',
  target: './build',
  flatten: true,
  icons: {
    png: {
      sizes: [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    },
    ico: {
      sizes: [16, 24, 32, 48, 64]
    }
  }
};

generateIcons(options)
  .then(() => {
    console.log('Icon generation completed successfully');
  })
  .catch(error => {
    console.error('Error generating icons:', error);
  });
