import { asClass } from "awilix";

import { MongoDBUsersRepository } from "@/src/infrastructure/repositories/mongodb.users.repository";

export const userRegistrations = {
    usersRepository: asClass(MongoDBUsersRepository).singleton(),
};
