// Seed default data for first run
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Default user
  await prisma.user.upsert({
    where: { id: 'local-dev' },
    update: {},
    create: {
      id: 'local-dev',
      displayName: 'Developer',
      focusState: 'available',
    },
  });

  // Default project
  await prisma.project.upsert({
    where: { id: 'proj-default' },
    update: {},
    create: {
      id: 'proj-default',
      name: 'My Project',
      key: 'TL',
      methodology: 'scrum',
    },
  });

  // Default board
  const board = await prisma.board.upsert({
    where: { id: 'board-default' },
    update: {},
    create: {
      id: 'board-default',
      projectId: 'proj-default',
      name: 'Kanban',
    },
  });

  // Default columns
  const cols = [
    { id: 'col-todo', name: 'To Do', mappedStatuses: 'todo', sortOrder: 0 },
    { id: 'col-progress', name: 'In Progress', mappedStatuses: 'in_progress', sortOrder: 1 },
    { id: 'col-review', name: 'Review', mappedStatuses: 'in_review', sortOrder: 2 },
    { id: 'col-done', name: 'Done', mappedStatuses: 'done', sortOrder: 3 },
  ];
  for (const c of cols) {
    await prisma.boardColumn.upsert({
      where: { id: c.id },
      update: {},
      create: { ...c, boardId: board.id },
    });
  }

  // LLM provider master data (Cloud API only)
  await prisma.llmProviderMaster.upsert({
    where: { name: 'deepseek' },
    update: {},
    create: { name: 'deepseek', displayName: 'DeepSeek', apiBaseUrl: 'https://api.deepseek.com', requiresKey: true },
  });
  await prisma.llmProviderMaster.upsert({
    where: { name: 'openai' },
    update: {},
    create: { name: 'openai', displayName: 'OpenAI', apiBaseUrl: 'https://api.openai.com/v1', requiresKey: true },
  });
  await prisma.llmProviderMaster.upsert({
    where: { name: 'qwen' },
    update: { displayName: 'Qwen (通义千问)', apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    create: { name: 'qwen', displayName: 'Qwen (通义千问)', apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', requiresKey: true },
  });
  await prisma.llmProviderMaster.upsert({
    where: { name: 'anthropic' },
    update: {},
    create: { name: 'anthropic', displayName: 'Anthropic (Claude)', apiBaseUrl: 'https://api.anthropic.com/v1', requiresKey: true },
  });
  await prisma.llmProviderMaster.upsert({
    where: { name: 'kimi' },
    update: { displayName: 'Kimi (Moonshot)', apiBaseUrl: 'https://api.moonshot.cn/v1' },
    create: { name: 'kimi', displayName: 'Kimi (Moonshot)', apiBaseUrl: 'https://api.moonshot.cn/v1', requiresKey: true },
  });

  // Default LLM config — Cloud API, user configures API key via Settings
  await prisma.llmConfig.upsert({
    where: { id: 'llm-default' },
    update: {},
    create: {
      id: 'llm-default',
      flashModel: 'deepseek-chat',
      proModel: 'deepseek-reasoner',
      ollamaUrl: '',
      ollamaEnabled: false,
    },
  });

  console.log('✅ Seed complete. Default project, board, and LLM config created.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
