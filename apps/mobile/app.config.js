const { expo } = require('./app.json');
const development = process.env.NODE_ENV === 'development';

module.exports = {
  ...expo,
  scheme: 'yoyos',
  android: { ...expo.android },
  ios: {
    ...expo.ios,
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
    ['expo-build-properties', { android: { usesCleartextTraffic: development } }],
  ],
};
