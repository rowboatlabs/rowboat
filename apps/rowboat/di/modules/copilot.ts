import { asClass } from "awilix";

import { CreateCopilotCachedTurnUseCase } from "@/src/application/use-cases/copilot/create-copilot-cached-turn.use-case";
import { RunCopilotCachedTurnUseCase } from "@/src/application/use-cases/copilot/run-copilot-cached-turn.use-case";
import { CreateCopilotCachedTurnController } from "@/src/interface-adapters/controllers/copilot/create-copilot-cached-turn.controller";
import { RunCopilotCachedTurnController } from "@/src/interface-adapters/controllers/copilot/run-copilot-cached-turn.controller";

export const copilotRegistrations = {
    createCopilotCachedTurnUseCase: asClass(CreateCopilotCachedTurnUseCase).singleton(),
    createCopilotCachedTurnController: asClass(CreateCopilotCachedTurnController).singleton(),
    runCopilotCachedTurnUseCase: asClass(RunCopilotCachedTurnUseCase).singleton(),
    runCopilotCachedTurnController: asClass(RunCopilotCachedTurnController).singleton(),
};
