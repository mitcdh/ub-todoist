
# Ultimate Brain to Todoist
This is a small node.js application to sync Tasks from Thomas Frank's [Ultimate Brain template](https://thomasjfrank.com/brain/) for [Notion](https://www.notion.so/) to [Todoist].

## Setup
### Notion Setup
1. Create a new internal [Notion Integration](https://www.notion.so/my-integrations/)
2. Take note of the *Internal Integration Token* displayed on the page as that will be used as the `NOTION_KEY` environment variable.
3. For each of the Ultimate Brains *All Tasks [UB]*, *Projects [UB]*, and *Areas/Resources [UB]* databases found under the Archive folder:
	* Unlock the database so modifications can be made
	* Add a Number property entitled *Todoist ID*
	* Add a Date property named *Todoist Last Update*
	* Share the database with the internal integration ceated in step (1)
	* Lock the database
4. Record the [ID for each of the notion databases](https://developers.notion.com/docs/working-with-databases#adding-pages-to-a-database) as they will be used as the *NOTION_TASKS_DB*, *NOTION_PROJECTS_DB*, and *NOTION_TASKS_DB* environment variables respectively.

### Todoist Setup
1. Go to the [Todoist integrations page](https://todoist.com/app/settings/integrations) within the Settings view of the web application.
2. Record the *API token* available at the bottom of the page as that will be used as the `TODOIST_KEY` environment variable.
Follow the guide in the Rancher repository [ui-driver-skel](https://github.com/rancher/ui-driver-skel) to prepare a build environment.

## Usage
Add all of the environment variables to a `.env` file and run the application, it will perform a one-time sync that will currently do the following:
* Create top-level Todoist projects for all Areas in the Ultimate Brain instance.
* Create second-level Todoist projects for all Projects in the Ultimate Brain instance.
* Create Todoist tasks and sub-tasks for all incomplete Tasks in the Ultimate Brain instance associated with a Project taking into account:
	* Name
	* Due date (but not reoccurrence)
	* Priority
* Complete tasks in Todoist if completed in Notion on a second sync.
* Complete tasks in Notion if completed in Todoist on a second sync.

## Todo
* Support creating tasks in Notion from tasks created under the Todoist projects.
* Support running as a daemon to run on a defined interval.
