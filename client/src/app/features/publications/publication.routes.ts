import { Routes } from '@angular/router';

import { PublicationListComponent } from './publication-list/publication-list.component';
import { PublicationFormComponent } from './publication-form/publication-form.component';
import { PublicationDetailComponent } from './publication-detail/publication-detail.component';
import { PublicationFacetListComponent } from './publication-facet-list/publication-facet-list.component';
import { authGuard } from '../../core/guards/auth.guard';

export const PUBLICATION_ROUTES: Routes = [
    { path: '', component: PublicationListComponent, title: 'Publications' },
    { path: 'new', component: PublicationFormComponent, canActivate: [authGuard], title: 'Create Publication' },
    { path: 'facets/:facet', component: PublicationFacetListComponent, title: 'Publication Facet' },
    { path: ':slug', component: PublicationDetailComponent, title: 'Publication Details' },
    { path: ':slug/edit', component: PublicationFormComponent, canActivate: [authGuard], title: 'Edit Publication' }
];
