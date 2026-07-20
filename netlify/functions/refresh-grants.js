const path = require('node:path');
const { refreshGrants } = require('../../scripts/refresh.js');

exports.handler = async function handler() {
  try {
    const result = await refreshGrants({
      outputPath: path.join('/tmp', 'ca-grant-match-grants.json'),
    });

    const buildHookUrl = process.env.NETLIFY_BUILD_HOOK_URL;
    if (buildHookUrl) {
      const response = await fetch(buildHookUrl, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`Netlify build hook returned HTTP ${response.status}.`);
      }
      console.log('[CA Grant Match] Weekly data verified; production rebuild requested.');
    } else {
      console.warn(
        '[CA Grant Match] NETLIFY_BUILD_HOOK_URL is not set. Data was verified, but the static site was not rebuilt.',
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (error) {
    console.error('\n[CA Grant Match] SCHEDULED REFRESH FAILED — the current production deploy remains live.');
    console.error(error instanceof Error ? error.stack : error);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: 'Grant refresh failed.' }),
    };
  }
};
