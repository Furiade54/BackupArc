import { Menu, type MenuItemConstructorOptions } from 'electron';

export function configurarMenu(): void {
  const esMac = process.platform === 'darwin';

  const plantilla: MenuItemConstructorOptions[] = [
    ...(esMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Archivo',
      submenu: [
        esMac
          ? { role: 'close', label: 'Cerrar ventana' }
          : { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño original' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(plantilla));
}
