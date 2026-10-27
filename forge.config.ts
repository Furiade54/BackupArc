import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const iconosPorPlataforma: Record<string, string> = {
  win32: 'assets/icons/win/icon',
  darwin: 'assets/icons/mac/icon',
  linux: 'assets/icons/png',
};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: iconosPorPlataforma[process.platform] ?? 'assets/icons/png',
    // Los iconos se copian fuera del asar para que la bandeja del sistema
    // pueda cargarlos en la aplicación empaquetada.
    extraResource: ['assets/icons'],
    // El plugin de Vite ignora todo salvo .vite; conservamos node_modules
    // porque mssql y dotenv se cargan como dependencias externas.
    ignore: (archivo: string) => {
      if (!archivo) {
        return false;
      }

      return !(
        archivo.startsWith('/.vite') ||
        archivo.startsWith('/node_modules') ||
        archivo.startsWith('/assets/icons')
      );
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-wix',
      config: {
        name: 'BackupArc',
        exe: 'backuparc.exe',
        manufacturer: 'BackupArc',
        description: 'BackupArc 2.0 - Gestion de respaldos de SQL Server',
        icon: 'assets/icons/win/icon.ico',
        shortcutName: 'BackupArc',
        ui: { chooseDirectory: true },
        // Identifica el producto entre versiones: sin este GUID fijo,
        // electron-wix-msi genera uno aleatorio en cada compilación y cada
        // versión se instala al lado de las anteriores. No debe cambiarse.
        upgradeCode: '7f3c1e2a-5b64-4d9a-9c8e-1a2b3c4d5e6f',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      config: {},
      platforms: ['darwin'],
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
