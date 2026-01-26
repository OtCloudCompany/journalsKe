import { Routes } from '@angular/router';

import { authGuard } from '../../core/guards/auth.guard';
import { HarvestLogListComponent } from './harvest-log-list/harvest-log-list.component';

export const HARVEST_LOG_ROUTES: Routes = [
    {
        path: '',
        component: HarvestLogListComponent,
        canActivate: [authGuard],
        title: 'Harvesting Logs'
    }
];
