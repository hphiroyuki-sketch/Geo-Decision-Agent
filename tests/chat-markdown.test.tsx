import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import ChatMarkdown from '../frontend/src/components/ChatMarkdown';
it('renders semantic formatting while rejecting raw HTML and script links',()=>{
  const html=renderToStaticMarkup(<ChatMarkdown content={'**重要**\n\n- 確認\n\n|項目|値|\n|---|---|\n|記録|0|\n\n[危険](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n![追跡](https://example.test/track)'} />);
  expect(html).toContain('<strong>重要</strong>');expect(html).toContain('<li>確認</li>');expect(html).toContain('<table>');expect(html).not.toContain('<script>');expect(html).not.toContain('href="javascript:');expect(html).not.toContain('<img');
});
