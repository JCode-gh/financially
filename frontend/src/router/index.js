import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import StockListView from '../views/StockListView.vue';
import StockDetailView from '../views/StockDetailView.vue';
import NewsView from '../views/NewsView.vue';
import OpportunitiesView from '../views/OpportunitiesView.vue';
import NotFoundView from '../views/NotFoundView.vue';

const routes = [
  { path: '/', name: 'dashboard', component: DashboardView },
  { path: '/watchlist', name: 'stocks', component: StockListView },
  { path: '/stock/:symbol([^/]+)', name: 'stock', component: StockDetailView },
  { path: '/news', name: 'news', component: NewsView },
  { path: '/opportunities', name: 'opportunities', component: OpportunitiesView },
  { path: '/:pathMatch(.*)*', name: 'notfound', component: NotFoundView }
];

export default createRouter({
  history: createWebHistory(),
  routes
});
