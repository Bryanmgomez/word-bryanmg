# Word BryanMG

Procesador de textos **moderno, elegante y en español**. Funciona en **Windows** (Electron), en el **navegador** y en **Android**. Todo el contenido se guarda localmente y la aplicación funciona **sin conexión**.

## Características

- Edición enriquecida: negrita, cursiva, subrayado, colores, resaltado, títulos, listas, alineación, sangrías, interlineado, tablas, imágenes, enlaces y saltos de página.
- Menús de cinta (Archivo, Inicio, Insertar, Diseño, Revisar, Vista, Herramientas, Ayuda) con acciones funcionales.
- Pantalla de inicio con acceso rápido: nuevo documento, abrir, recientes, favoritos y plantillas.
- **Organización**: carpetas, renombrado, duplicado, mover, **favoritos** y papelera con restaurar.
- **Encabezado y pie de página**, numeración «Página X de Y» y vista previa de páginas en el panel lateral.
- **Autoguardado** cada 1,2 s tras escribir y **historial de versiones** (últimas 20) para volver atrás.
- **Exportar e importar**: DOCX, ODT, PDF (impresión), TXT y HTML.
- Esquema automático del documento a partir de los títulos.
- Buscar y reemplazar con resaltado.
- **Personalización**: tema claro/oscuro, tamaño de la interfaz, apariencia de la barra de herramientas y fondo del editor.
- Modo oscuro, zoom (50 %–200 %), corrector ortográfico y atajos de teclado en español.
- 100 % sin conexión: almacenamiento en IndexedDB y *service worker* precacheado.
- Creado por BryanMG.

## Estructura

| Ruta | Contenido |
| --- | --- |
| `src/main/` | Proceso principal de Electron, IPC y servicios de archivos |
| `src/renderer/index.html` | Interfaz (HTML + iconos SVG inline) |
| `src/renderer/css/` | Estilos (`base`, `layout`, `editor`, `print`) |
| `src/renderer/js/core/` | Editor, formatos (DOCX/ODT/TXT/HTML), ZIP, almacenamiento, atajos |
| `src/renderer/js/components/` | Diálogos, menú de archivo, personalización, buscar, imágenes, panel lateral, estado |
| `src/renderer/js/pages/` | Gestor de archivos e historial de cambios |
| `scripts/` | Servidor web de desarrollo y suites de verificación |

## Desarrollo

Requisitos: Node 20+ y Chrome (para las pruebas automáticas).

```bash
npm install
npm start          # abre la app de escritorio (Electron)
npm run web        # ejecuta la versión web en http://localhost:4173
npm test           # verificación automática completa (Puppeteer + Chrome)
npm run smoke      # comprueba que Electron arranca sin errores
```

La ruta de Chrome se puede indicar con la variable `PAPIRO_CHROME`.

## Uso

- `Ctrl+S` guardar · `Ctrl+N` nuevo · `Ctrl+O` abrir · `Ctrl+P` imprimir
- `Ctrl+F` buscar · `Ctrl+H` buscar y reemplazar · `Ctrl+K` enlace
- `Ctrl+B / I / U` negrita, cursiva, subrayado · `Ctrl+Z / Ctrl+Y` deshacer / rehacer
- `Ctrl++ / Ctrl+- / Ctrl+0` zoom · `Ctrl+Alt+F` menú de archivo · `Esc` cerrar

Los documentos se guardan **solo en tu dispositivo** (IndexedDB); no se envía ningún dato a servidores.

## Empaquetado para Windows

```bash
npm run dist       # genera el instalador con electron-builder
```