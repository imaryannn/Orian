const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isToolAllowed } = require('../services/composio');
test('repository writes cannot create commits through connector tools', () => {
  for (const slug of ['GITHUB_CREATE_A_COMMIT', 'GITHUB_COMMIT_MULTIPLE_FILES', 'GITHUB_DELETE_A_FILE', 'GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS', 'GITHUB_MERGE_A_PULL_REQUEST', 'GITHUB_CREATE_A_REFERENCE']) assert.equal(isToolAllowed('github', slug), false, slug);
});
test('GitHub reads and explicit issue/gist tasks remain usable', () => {
  for (const slug of ['GITHUB_GET_REPOSITORY_CONTENT', 'GITHUB_SEARCH_CODE', 'GITHUB_CREATE_AN_ISSUE', 'GITHUB_CREATE_A_GIST']) assert.equal(isToolAllowed('github', slug), true, slug);
});
