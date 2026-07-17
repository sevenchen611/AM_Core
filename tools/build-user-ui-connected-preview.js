'use strict';

import('./build-user-ui-connected-preview.mjs').catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
