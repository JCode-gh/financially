import { createRouter, createWebHistory } from 'vue-router';
import StockListView from '../views/StockListView.vue';
import StockDetailView from '../views/StockDetailView.vue';
import NewsView from '../views/NewsView.vue';
import OpportunitiesView from '../views/OpportunitiesView.vue';

const routes = [
  { path: '/', name: 'stocks', component: StockListView },
  { path: '/stock/:symbol([^/]+)', name: 'stock', component: StockDetailView },
  { path: '/news', name: 'news', component: NewsView },
  { path: '/opportunities', name: 'opportunities', component: OpportunitiesView }
];

export default createRouter({
  history: createWebHistory(),
  routes
});
