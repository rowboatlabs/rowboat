import { asClass } from "awilix";

import { MongoDBJobsRepository } from "@/src/infrastructure/repositories/mongodb.jobs.repository";
import { MongoDBScheduledJobRulesRepository } from "@/src/infrastructure/repositories/mongodb.scheduled-job-rules.repository";
import { MongoDBRecurringJobRulesRepository } from "@/src/infrastructure/repositories/mongodb.recurring-job-rules.repository";
import { ListJobsUseCase } from "@/src/application/use-cases/jobs/list-jobs.use-case";
import { FetchJobUseCase } from "@/src/application/use-cases/jobs/fetch-job.use-case";
import { ListJobsController } from "@/src/interface-adapters/controllers/jobs/list-jobs.controller";
import { FetchJobController } from "@/src/interface-adapters/controllers/jobs/fetch-job.controller";
import { CreateScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/create-scheduled-job-rule.use-case";
import { FetchScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/fetch-scheduled-job-rule.use-case";
import { ListScheduledJobRulesUseCase } from "@/src/application/use-cases/scheduled-job-rules/list-scheduled-job-rules.use-case";
import { DeleteScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/delete-scheduled-job-rule.use-case";
import { UpdateScheduledJobRuleUseCase } from "@/src/application/use-cases/scheduled-job-rules/update-scheduled-job-rule.use-case";
import { CreateScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/create-scheduled-job-rule.controller";
import { FetchScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/fetch-scheduled-job-rule.controller";
import { ListScheduledJobRulesController } from "@/src/interface-adapters/controllers/scheduled-job-rules/list-scheduled-job-rules.controller";
import { DeleteScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/delete-scheduled-job-rule.controller";
import { UpdateScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/update-scheduled-job-rule.controller";
import { CreateRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/create-recurring-job-rule.use-case";
import { FetchRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/fetch-recurring-job-rule.use-case";
import { ListRecurringJobRulesUseCase } from "@/src/application/use-cases/recurring-job-rules/list-recurring-job-rules.use-case";
import { ToggleRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/toggle-recurring-job-rule.use-case";
import { DeleteRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/delete-recurring-job-rule.use-case";
import { UpdateRecurringJobRuleUseCase } from "@/src/application/use-cases/recurring-job-rules/update-recurring-job-rule.use-case";
import { CreateRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/create-recurring-job-rule.controller";
import { FetchRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/fetch-recurring-job-rule.controller";
import { ListRecurringJobRulesController } from "@/src/interface-adapters/controllers/recurring-job-rules/list-recurring-job-rules.controller";
import { ToggleRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/toggle-recurring-job-rule.controller";
import { DeleteRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/delete-recurring-job-rule.controller";
import { UpdateRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/update-recurring-job-rule.controller";

export const jobRegistrations = {
    jobsRepository: asClass(MongoDBJobsRepository).singleton(),
    listJobsUseCase: asClass(ListJobsUseCase).singleton(),
    listJobsController: asClass(ListJobsController).singleton(),
    fetchJobUseCase: asClass(FetchJobUseCase).singleton(),
    fetchJobController: asClass(FetchJobController).singleton(),
    scheduledJobRulesRepository: asClass(MongoDBScheduledJobRulesRepository).singleton(),
    createScheduledJobRuleUseCase: asClass(CreateScheduledJobRuleUseCase).singleton(),
    fetchScheduledJobRuleUseCase: asClass(FetchScheduledJobRuleUseCase).singleton(),
    listScheduledJobRulesUseCase: asClass(ListScheduledJobRulesUseCase).singleton(),
    updateScheduledJobRuleUseCase: asClass(UpdateScheduledJobRuleUseCase).singleton(),
    deleteScheduledJobRuleUseCase: asClass(DeleteScheduledJobRuleUseCase).singleton(),
    createScheduledJobRuleController: asClass(CreateScheduledJobRuleController).singleton(),
    fetchScheduledJobRuleController: asClass(FetchScheduledJobRuleController).singleton(),
    listScheduledJobRulesController: asClass(ListScheduledJobRulesController).singleton(),
    updateScheduledJobRuleController: asClass(UpdateScheduledJobRuleController).singleton(),
    deleteScheduledJobRuleController: asClass(DeleteScheduledJobRuleController).singleton(),
    recurringJobRulesRepository: asClass(MongoDBRecurringJobRulesRepository).singleton(),
    createRecurringJobRuleUseCase: asClass(CreateRecurringJobRuleUseCase).singleton(),
    fetchRecurringJobRuleUseCase: asClass(FetchRecurringJobRuleUseCase).singleton(),
    listRecurringJobRulesUseCase: asClass(ListRecurringJobRulesUseCase).singleton(),
    toggleRecurringJobRuleUseCase: asClass(ToggleRecurringJobRuleUseCase).singleton(),
    updateRecurringJobRuleUseCase: asClass(UpdateRecurringJobRuleUseCase).singleton(),
    deleteRecurringJobRuleUseCase: asClass(DeleteRecurringJobRuleUseCase).singleton(),
    createRecurringJobRuleController: asClass(CreateRecurringJobRuleController).singleton(),
    fetchRecurringJobRuleController: asClass(FetchRecurringJobRuleController).singleton(),
    listRecurringJobRulesController: asClass(ListRecurringJobRulesController).singleton(),
    toggleRecurringJobRuleController: asClass(ToggleRecurringJobRuleController).singleton(),
    updateRecurringJobRuleController: asClass(UpdateRecurringJobRuleController).singleton(),
    deleteRecurringJobRuleController: asClass(DeleteRecurringJobRuleController).singleton(),
};
