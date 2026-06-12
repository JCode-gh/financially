import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router/index.js';
import './style.css';
import { useAuthStore } from './stores/authStore.js';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

useAuthStore(pinia).init();

app.mount('#app');
