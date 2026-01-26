import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'journals',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'publications',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'researchers',
    renderMode: RenderMode.Prerender
  },
  {
    path: '**',
    renderMode: RenderMode.Server
  }
];
