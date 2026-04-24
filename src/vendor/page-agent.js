import { PageAgentCore } from './page-agent-core.js';
import { PageController } from '@page-agent/page-controller';
import { Panel } from '@page-agent/ui';

class PageAgent extends PageAgentCore {
  panel;

  constructor(config) {
    const pageController = new PageController({
      ...config,
      enableMask: config.enableMask ?? true,
    });
    super({ ...config, pageController });
    this.panel = new Panel(this, {
      language: config.language,
      promptForNextTask: config.promptForNextTask,
    });
  }
}

export { PageAgent };
