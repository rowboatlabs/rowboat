import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useConnection } from '@/lib/connection';

export default function Index() {
  const { pairing } = useConnection();
  if (pairing === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={pairing ? '/sessions' : '/pairing'} />;
}
