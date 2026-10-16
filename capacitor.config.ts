import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'todowork.reip.my.id',
  appName: 'Todowork',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
};

export default config;
