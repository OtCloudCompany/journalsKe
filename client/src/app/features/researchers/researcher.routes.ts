import { Routes } from '@angular/router';

import { ResearcherDetailComponent } from './researcher-detail/researcher-detail.component';
import { ResearcherListComponent } from './researcher-list/researcher-list.component';
import { ResearcherManageComponent } from './researcher-manage/researcher-manage.component';
import { ResearcherVerifyEmailComponent } from './researcher-verify-email/researcher-verify-email.component';
import { authGuard } from '../../core/guards/auth.guard';

export const RESEARCHER_ROUTES: Routes = [
    { path: '', component: ResearcherListComponent, title: 'Researchers' },
    { path: 'verify-institutional-email', component: ResearcherVerifyEmailComponent, title: 'Verify Institutional Email' },
    { path: 'me', component: ResearcherManageComponent, canActivate: [authGuard], title: 'Manage Researcher Profile' },
    { path: ':slug', component: ResearcherDetailComponent, title: 'Researcher Profile' }
];
