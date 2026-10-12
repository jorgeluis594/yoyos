const { expo } = require('./app.json');
const development = process.env.NODE_ENV === 'development';

module.exports = {
  ...expo,
  scheme: 'yoyos',
  android: { ...expo.android, package: 'com.yoyos.mobile', minSdkVersion: 24 },
  ios: {
    ...expo.ios,
    deploymentTarget: '16.4',
    infoPlist: development ? {
      NSAppTransportSecurity: {
        NSExceptionDomains: {
          localhost: { NSExceptionAllowsInsecureHTTPLoads: true },
        },
      },
    } : undefined,
  },
  plugins: [
    ...expo.plugins,
    'expo-asset',
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-image-picker', {
      photosPermission: 'Permitir que Yoyos use tus fotos en productos.',
      cameraPermission: 'Permitir que Yoyos tome fotos para tus productos.',
    }],
    ['expo-build-properties', { android: { usesCleartextTraffic: development, buildArchs: ['arm64-v8a', 'x86_64'] } }],
  ],
};
