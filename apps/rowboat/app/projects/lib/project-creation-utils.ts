import { createProject, createProjectFromWorkflowJson } from "@/app/actions/project_actions";

export interface CreateProjectOptions {
  name: string;
  template?: string;
  prompt?: string;
  router: any; // NextJS router instance
  onSuccess?: (projectId: string) => void;
  onError?: (error: any) => void;
}

export interface CreateProjectFromJsonOptions {
  name: string;
  workflowJson: string;
  router: any; // NextJS router instance
  onSuccess?: (projectId: string) => void;
  onError?: (error: any) => void;
}

/**
 * Consolidated function to create a project with consistent error handling and navigation
 */
export async function createProjectWithOptions(options: CreateProjectOptions): Promise<void> {
  try {
    const formData = new FormData();
    formData.append('name', options.name);
    
    if (options.template) {
      formData.append('template', options.template);
    }

    const response = await createProject(formData);
    
    if ('id' in response) {
      // Store prompt in localStorage if provided
      if (options.prompt?.trim()) {
        localStorage.setItem(`project_prompt_${response.id}`, options.prompt);
      }
      
      // Call success callback if provided
      if (options.onSuccess) {
        options.onSuccess(response.id);
      }
      
      // Navigate to workflow page
      options.router.push(`/projects/${response.id}/workflow`);
    } else {
      // Handle error response
      const error = (response as any).billingError || 'Failed to create project';
      if (options.onError) {
        options.onError(error);
      } else {
        throw new Error(error);
      }
    }
  } catch (error) {
    console.error('Error creating project:', error);
    if (options.onError) {
      options.onError(error);
    } else {
      throw error;
    }
  }
}

/**
 * Consolidated function to create a project from JSON workflow
 */
export async function createProjectFromJsonWithOptions(options: CreateProjectFromJsonOptions): Promise<void> {
  try {
    const formData = new FormData();
    formData.append('name', options.name);
    formData.append('workflowJson', options.workflowJson);

    const response = await createProjectFromWorkflowJson(formData);
    
    if ('id' in response) {
      // Call success callback if provided
      if (options.onSuccess) {
        options.onSuccess(response.id);
      }
      
      // Navigate to workflow page
      options.router.push(`/projects/${response.id}/workflow`);
    } else {
      // Handle error response
      const error = (response as any).billingError || 'Failed to create project';
      if (options.onError) {
        options.onError(error);
      } else {
        throw new Error(error);
      }
    }
  } catch (error) {
    console.error('Error creating project from JSON:', error);
    if (options.onError) {
      options.onError(error);
    } else {
      throw error;
    }
  }
}

/**
 * Consolidated function to create a project from template selection
 */
export async function createProjectFromTemplate(
  templateId: string,
  templateName: string,
  router: any,
  onError?: (error: any) => void
): Promise<void> {
  return createProjectWithOptions({
    name: templateName,
    template: templateId,
    router,
    onError
  });
}