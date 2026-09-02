import { createIssue, getStats, listIssues, getIssue, updateIssue, suggestIssueEdit } from './issueTools.js';
import { createNote, updateNote, listNotes, suggestNoteEdit, searchNotesSemantic } from './noteTools.js';
import {
  createReport,
  updateReport,
  listReports,
  getReport,
  deleteReport,
  suggestReportEdit,
  exportToExcel,
  exportToDoc,
  exportToHtml,
  exportToPptx,
} from './reportTools.js';
import { braveSearch, webSearch, searchLocalData } from './searchTools.js';
import { listGitCommits, listWorkspaces } from './gitTools.js';
import {
  listEmails,
  editEmailReply,
  sendEmailReply,
  readEmailOriginal,
  dismissEmail,
  deleteEmail,
} from './emailTools.js';
import { shellExec } from '../utils/shell.js';
import { mcpCall } from '../utils/mcp.js';
import { parseMcpToolName } from '../mcp/inject.js';
import { createMCPClient } from '../mcp/client.js';
import { decrypt } from '../../lib/crypto.js';
import { prisma } from '@tomilite/database';
import { executeEmailTool } from '../../routers/emailTools.js';

/** Central dispatcher: routes tool name → handler function, with email fallback */
export async function executeAgentTool(tool: string, args: Record<string, any>): Promise<any> {
  switch (tool) {
    case 'create_issue':
    case 'force_create_issue':
      return createIssue(args);
    case 'get_stats':
      return getStats();
    case 'list_issues':
      return listIssues(args);
    case 'get_issue':
      return getIssue(args);
    case 'search_notes': {
      return searchNotesSemantic(args.query?.trim() || '', 5);
    }
    case 'list_notes':
      return listNotes(args);
    case 'update_issue':
      return updateIssue(args);
    case 'force_create_report':
    case 'create_report':
      return createReport(args);
    case 'update_report':
      return updateReport(args);
    case 'force_create_note':
    case 'create_note':
      return createNote(args);
    case 'update_note':
      return updateNote(args);
    case 'suggest_note_edit':
      return suggestNoteEdit(args);
    case 'suggest_issue_edit':
      return suggestIssueEdit(args);
    case 'suggest_report_edit':
      return suggestReportEdit(args);
    case 'brave_search':
      return braveSearch(args);
    case 'web_search':
      return webSearch(args);
    case 'search_local_data':
      return searchLocalData(args);
    case 'list_git_commits':
      return listGitCommits(args);
    case 'list_workspaces':
      return listWorkspaces(args);
    case 'shell_exec': {
      return shellExec(args.command, args.cwd);
    }
    case 'mcp_call': {
      return mcpCall(args.server, args.tool, args.args);
    }
    case 'list_emails':
      return listEmails(args);
    case 'edit_email_reply':
      return editEmailReply(args);
    case 'send_email_reply':
      return sendEmailReply(args);
    case 'read_email_original':
      return readEmailOriginal(args);
    case 'dismiss_email':
      return dismissEmail(args);
    case 'delete_email':
      return deleteEmail(args);
    case 'list_reports':
      return listReports(args);
    case 'get_report':
      return getReport(args);
    case 'delete_report':
      return deleteReport(args);
    case 'polish_report':
    case 'summarize_report':
    case 'expand_report':
    case 'translate_report':
      // Auto-apply the processed content to the report editor via suggest_report_edit
      return suggestReportEdit({
        content: args.content,
        title: args.title,
      });
    case 'export_to_excel':
      return exportToExcel(args);
    case 'export_to_doc':
      return exportToDoc(args);
    case 'export_to_html':
      return exportToHtml(args);
    case 'export_to_ppt':
      return exportToPptx(args);
    case 'export_to_pdf': {
      // Server renders HTML; Electron main prints to PDF via the renderer's printPdf IPC.
      // filePath here is display-only (the real PDF is written by printPdf in the renderer) —
      // keep it consistent with the .pdf filename so the card/agent reply don't show .pdf.pdf.
      // The agent often passes a filename already ending in .pdf (e.g. "方案.pdf"), which
      // exportToHtml turns into "方案.pdf.html" — strip all trailing .html/.pdf before
      // appending .pdf so we never double the suffix.
      const result = await exportToHtml(args);
      if (result.error) return result;
      const stripTrailing = (s: string) => s.replace(/(\.html|\.pdf)+$/i, '');
      const pdfName = stripTrailing(result.filename) + '.pdf';
      return { ...result, type: 'pdf', filename: pdfName, filePath: stripTrailing(result.filePath) + '.pdf' };
    }
    default: {
      // ─── Dynamic MCP tool dispatch: mcp__<server>__<tool> ───
      const parsed = parseMcpToolName(tool);
      if (parsed) {
        try {
          // Look up server by sanitized name — try McpServer first
          const server = await prisma.mcpServer.findFirst({
            where: { name: parsed.serverName, enabled: true },
          });
          if (server) {
            let apiKey: string | undefined;
            if (server.apiKey) {
              try {
                apiKey = await decrypt(server.apiKey);
              } catch {
                apiKey = server.apiKey;
              }
            }
            let headers: Record<string, string> = {};
            if (server.headers) {
              try {
                headers = JSON.parse(server.headers);
              } catch {
                /* not JSON */
              }
            }
            const client = createMCPClient({
              name: server.name,
              url: server.url,
              apiKey,
              headers,
              transport: (server.transport || 'plain') as any,
            });
            const result = await client.callTool(parsed.toolName, args);
            if (!result.ok) return { error: result.error || 'MCP call failed' };
            return { server: server.name, tool: parsed.toolName, result: result.result };
          }
          // Fallback: use generic mcpCall (Integration table)
          return mcpCall(parsed.serverName, parsed.toolName, JSON.stringify(args));
        } catch (e: any) {
          return { error: `MCP tool "${tool}" failed: ${e.message || e}` };
        }
      }

      const emailResult = await executeEmailTool(tool, args);
      const err =
        emailResult && typeof emailResult === 'object' && 'error' in emailResult
          ? (emailResult as Record<string, unknown>).error
          : null;
      if (emailResult && !err) return emailResult;
      if (typeof err === 'string' && !err.includes('Unknown')) return emailResult;
      return { error: `Unknown tool: ${tool}` };
    }
  }
}
