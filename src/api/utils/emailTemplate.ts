import fs from "fs";
import path from "path";
import Handlebars from "handlebars";

const templatesDir = path.join(__dirname, "templates");
const compiledTemplates = new Map<string, HandlebarsTemplateDelegate>();

export const renderEmailTemplate = (name: string, data: Record<string, unknown>): string => {
    let template = compiledTemplates.get(name);

    if (!template) {
        const filePath = path.join(templatesDir, `${name}.hbs`);
        const source = fs.readFileSync(filePath, "utf-8");
        template = Handlebars.compile(source);
        compiledTemplates.set(name, template);
    }

    return template(data);
};
