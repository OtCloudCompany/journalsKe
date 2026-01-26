import { Routes } from '@angular/router';

import { AUTH_FEATURE_ROUTES } from './features/auth/auth.routes';
import { JOURNAL_ROUTES } from './features/journals/journal.routes';
import { ACCOUNT_ROUTES } from './features/account/account.routes';
import { PUBLICATION_ROUTES } from './features/publications/publication.routes';
import { RESEARCHER_ROUTES } from './features/researchers/researcher.routes';
import { HARVEST_LOG_ROUTES } from './features/harvest-logs/harvest-log.routes';
import { HomePageComponent } from './pages/home/home-page.component';

export const routes: Routes = [
    {
        path: '',
        component: HomePageComponent,
        title: 'KeJOL | Directory of Kenyan Research'
    },
    {
        path: 'auth',
        loadChildren: () => AUTH_FEATURE_ROUTES
    },
    {
        path: 'account',
        loadChildren: () => ACCOUNT_ROUTES
    },
    {
        path: 'journals',
        loadChildren: () => JOURNAL_ROUTES
    },
    {
        path: 'harvest-logs',
        loadChildren: () => HARVEST_LOG_ROUTES
    },
    {
        path: 'publications',
        loadChildren: () => PUBLICATION_ROUTES
    },
    {
        path: 'researchers',
        loadChildren: () => RESEARCHER_ROUTES
    },
    {
        path: '**',
        redirectTo: '',
        pathMatch: 'full'
    }
];
