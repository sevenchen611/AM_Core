'use strict';

import('./validate-user-ui-pages.mjs').catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
