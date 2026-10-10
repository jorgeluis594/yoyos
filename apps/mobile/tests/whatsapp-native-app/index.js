import { registerRootComponent, requireOptionalNativeModule } from 'expo';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

function App() {
  const [result, setResult] = useState('pending');
  useEffect(() => {
    const module = requireOptionalNativeModule('WhatsApp');
    if (!module) { setResult('module-unavailable'); return; }
    Promise.all([module.probe('{}', false), module.probe('{}', true)])
      .then(([value, error]) => setResult(value.status === 'ok' && value.value === '{}'
        && error.status === 'error' && error.code === 'NATIVE_CALL_FAILED' ? 'bridge-ok' : 'bridge-failed'))
      .catch(() => setResult('bridge-failed'));
  }, []);
  return <View><Text accessibilityLabel="WhatsApp probe result">{result}</Text></View>;
}

registerRootComponent(App);
