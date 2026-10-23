const { expo } = require('./app.json');
const development = process.env.NODE_ENV === 'development';

module.exports = {
  ...expo,
  scheme: 'yoyos',
  // EAS injects GOOGLE_SERVICES_JSON as a file secret (FCM v1); google-services.json stays out of Git.
  android: {
    ...expo.android,
    package: 'com.yoyos.mobile',
    minSdkVersion: 24,
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  extra: { ...expo.extra, eas: { ...expo.extra?.eas, projectId: process.env.EAS_PROJECT_ID } },
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
    ['expo-notifications', { defaultChannel: 'chat-notices' }],
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-image-picker', {
      photosPermission: 'Permitir que Yoyos use tus fotos en productos.',
      cameraPermission: 'Permitir que Yoyos tome fotos para tus productos.',
    }],
    ['expo-build-properties', { android: { usesCleartextTraffic: development, buildArchs: ['arm64-v8a', 'x86_64'] } }],
  ],
};
