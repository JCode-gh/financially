<template>
  <div class="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
    <div class="font-mono text-accent text-2xl">404</div>
    <p class="text-sm">{{ $t('notFound.missing') }}</p>
    <RouterLink to="/" class="text-xs font-mono text-accent hover:text-accent/70">{{ $t('notFound.back') }}</RouterLink>
  </div>
</template>
