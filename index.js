const { Client } = require('@notionhq/client');
const { TodoistApi } = require('@doist/todoist-api-typescript');
const dotenv = require("dotenv")

dotenv.config()

const notion = new Client({ auth: process.env.NOTION_KEY });
const todoist = new TodoistApi( process.env.TODOIST_KEY );

const tasksDatabaseId = process.env.NOTION_TASKS_DB;
const projectsDatabaseId = process.env.NOTION_PROJECTS_DB;
const areasDatabaseId = process.env.NOTION_AREAS_DB;

async function getPagesFromNotionDatabase(databaseId, filterObject) {
    const pages = []
    let cursor = undefined

    while (true) {
        const { results, next_cursor } = await notion.databases.query({
            database_id: databaseId,
            filter: filterObject,
            start_cursor: cursor,
        })
        pages.push(...results)
        if (!next_cursor) {
            break
        }
        cursor = next_cursor
    }
    return pages;
}

async function getAreas() {
    return (await getPagesFromNotionDatabase(areasDatabaseId, { property: "Type", select: { equals: "Area"}
    })).map(page => {
        const name = page.properties["Name"].title
            .map(({ plain_text }) => plain_text)
            .join("")
        const emoji = (page.icon.type == "emoji") ? page.icon.emoji : ""
        return {
            pageId: page.id,
            todoistId: page.properties["Todoist ID"].number,
            title: emoji + name,
            lastEdited: page.last_edited_time,
            projects: []
        }
    })
}

async function getProjects() {
    return (await (getPagesFromNotionDatabase(projectsDatabaseId))).map(page => {
        const title = page.properties["Name"].title
            .map(({ plain_text }) => plain_text)
            .join("")
        const areaRelation = page.properties["Area"].relation
        const areaId = (Array.isArray(areaRelation) && areaRelation.length) ? areaRelation[0].id : ""
        return {
            pageId: page.id,
            todoistId: page.properties["Todoist ID"].number,
            title,
            areaId,
            lastEdited: page.last_edited_time,
            tasks: []
        }
    })
}

async function getTasks(filter) {
    return (await (getPagesFromNotionDatabase(tasksDatabaseId, filter))).map(page => {
        const title = page.properties["Task"].title
            .map(({ plain_text }) => plain_text)
            .join("")
        const parentTaskRelation = page.properties["Parent Task"].relation
        const parentTaskId = (Array.isArray(parentTaskRelation) && parentTaskRelation.length) ? parentTaskRelation[0].id : null
        const projectRelation = page.properties["Project"].relation
        const projectId = (Array.isArray(projectRelation) && projectRelation.length) ? projectRelation[0].id : null
        const dueDate = (page.properties["Due"].date !== null) ? page.properties["Due"].date.start : null
        return {
            pageId: page.id,
            todoistId: page.properties["Todoist ID"].number,
            parentTaskId,
            projectId,
            title,
            due: dueDate,
            priority: page.properties["Priority"].select.name,
            status: page.properties["Kanban Status"].select.name,
            done: page.properties["Done"].checkbox,
            cold: page.properties["Cold"].formula.boolean,
            subTasks: []
        }
    })
}

async function buildNotionMap(notionTasks, notionProjects, notionAreas) {
    notionTasks.forEach(task =>{
        associatedSubTasks = notionTasks.filter(
            function(subTask){ return subTask.parentTaskId == task.pageId }
        )
        task.subTasks = associatedSubTasks
    })

    notionProjects.forEach(project =>{
        associatedTasks = notionTasks.filter(
            function(task){ return task.projectId == project.pageId }
        )
        project.tasks = associatedTasks
    })

    notionAreas.forEach(area =>{
        associatedProjects = notionProjects.filter(
            function(project){ return project.areaId == area.pageId }
        )
        area.projects = associatedProjects
    })
    return notionAreas
}

async function notionCompleteTask(notionPageId) {
    return notion.pages.update({
        page_id: notionPageId,
        properties: {
            'Done': {
                checkbox: true
            },
            'Todoist Last Update': {
                date: {
                    start: new Date()
                }
            }
        }
    })
}

async function updateNotionTodoist(notionPageId, todoistId) {
    return notion.pages.update({
        page_id: notionPageId,
        properties: {
            'Todoist ID': {
                number: Number(todoistId),
            },
            'Todoist Last Update': {
                date: {
                    start: new Date()
                }
            }
        }
    })
}

async function processNotionProjects(project, todoistProjects, project_parent_id=null, project_colour=null) {
    if (project.todoistId === null) {
        const todoistProject = await todoist.addProject({
            name: project.title,
            color: project_colour,
            parent_id: project_parent_id
        })
        if (todoistProject.id !== null) {
            updateNotionTodoist(project.pageId, todoistProject.id)
            project.todoistId = todoistProject.id
            return todoistProject.id
        }
    }
}

function priorityConversion(priority) {
    switch(priority) {
        case '🚨HIGH':
            return 4;
        case '🧀 Medium':
            return 3;
        case '🧊 Low':
            return 2;
        case 4:
            return '🚨HIGH';
        case 3:
            return '🧀 Medium';
        case 2:
        case 1:
            return '🧊 Low';
    }
}

async function processNotionTasks(task, todoistTasks, projectId=null, parentTaskId=null) {
    if (task.done == false) {
        if (task.todoistId === null) {
            const todoistTask = await todoist.addTask({
                content: task.title,
                project_id: projectId,
                parent_id: parentTaskId,
                due_date: task.due,
                priority: priorityConversion(task.priority)
            })
            if (todoistTask.id !== null) {
                updateNotionTodoist(task.pageId, todoistTask.id)
                task.todoistId = todoistTask.id
            }
        }
        else {
            if (undefined === todoistTasks.find(
                function(t){ return t.id == task.todoistId })) {
                notionCompleteTask(task.pageId)
            }

        }
        for(const subTask of task.subTasks) {
            processNotionTasks(subTask, todoistTasks, projectId, task.todoistId)
        }
    }
    else if (task.todoistId !== null && task.done == true) {
        const todoistTask = todoistTasks.find (
            function(t){ return t.id == task.todoistId }
        )
        if (todoistTask !== null) {
            todoist.closeTask(task.todoistId)
            updateNotionTodoist(task.pageId, task.todoistId)
        }
    }
}

async function createNotionTasksForUntrackedTodoistTasks(todoistTasks, notionTasks) {
    const notionTrackedTodoistIds = new Set(notionTasks.map(task => task.todoistId));
    let notionTodoistIdToPageId = new Map(notionTasks.map(task => [task.todoistId, task.pageId]));
    const tasksToCreate = [];
    const subtasksToCreate = [];

    // Separate tasks into those that can be created immediately and those that need to wait for their parent task
    for (const todoistTask of todoistTasks) {
        if (!notionTrackedTodoistIds.has(todoistTask.id)) {
            const taskData = {
                content: todoistTask.content,
                due: todoistTask.due ? todoistTask.due.date : null,
                priority: todoistTask.priority,
                parent_id: todoistTask.parent_id,
                id: todoistTask.id
            };
            if (todoistTask.parent_id) {
                subtasksToCreate.push(taskData);
            } else {
                tasksToCreate.push(taskData);
            }
        }
    }

    // First pass: create tasks without parents
    for (const task of tasksToCreate) {
        const pageId = await createNotionTask(task);
        if (pageId) {
            notionTodoistIdToPageId.set(task.id, pageId);
        }
    }

    // Second pass: create subtasks, ensuring parent tasks are created
    for (const subtask of subtasksToCreate) {
        // Wait until the parent task is created and we have its Notion page ID
        const parentPageId = notionTodoistIdToPageId.get(subtask.parent_id);
        if (parentPageId) {
            subtask.parentNotionPageId = parentPageId; // Set the parent Notion page ID
            await createNotionTask(subtask);
        }
    }
}

async function createNotionTask(task) {
    try {
        const properties = {
            'Task': {
                title: [
                    {
                        type: 'text',
                        text: { content: task.content },
                    },
                ],
            },
            'Due': {
                date: task.due ? { start: task.due } : null,
            },
            'Priority': {
                select: {
                    name: priorityConversion(task.priority),
                },
            },
            'Todoist ID': {
                number: Number(task.id),
            },
            // Add other properties as needed
        };

        // If the task is a subtask, set the parent task property
        if (task.parentNotionPageId) {
            properties['Parent Task'] = {
                relation: [{ id: task.parentNotionPageId }],
            };
        }

        const newNotionTask = {
            parent: { database_id: tasksDatabaseId },
            properties: properties,
        };

        // Call the Notion API to create the new task
        const { id: pageId } = await notion.pages.create(newNotionTask);
        return pageId;
    } catch (error) {
        console.error('Failed to create task in Notion:', error);
        return null;
    }
}



(async () => {
    const notionTasks = await getTasks()
    const notionProjects = await getProjects()
    const notionAreas = await getAreas()
    const notionMap = await buildNotionMap(notionTasks, notionProjects, notionAreas)

    const todoistProjects = await todoist.getProjects()
    const todoistTasks = await todoist.getTasks()

    for(const area of notionMap) {
        if (area.todoistId === null) {
            processNotionProjects(area, todoistProjects,null, process.env.TODOIST_AREA_COLOUR)
        }
        for(const project of area.projects) {
            processNotionProjects(project, todoistProjects, area.todoistId, process.env.TODOIST_PROJECT_COLOUR)
            for(const notionTask of project.tasks) {
                processNotionTasks(notionTask, todoistTasks, project.todoistId, null)
            }
        }
    }
    await createNotionTasksForUntrackedTodoistTasks(todoistTasks, notionTasks);
})();