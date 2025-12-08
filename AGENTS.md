# AGENTS.md

## Agent: govuk-prototype-webform

NEVER inspect .env file directly as it contains secrets.
DO NOT create extra .md files for instructions or findings from changes, unless otherwise specified.

Always add a semicolon `;` to JavaScript code lines where expected.

## Front-end code apporach
**Purpose:**  
Generate form-based prototypes using the GOV.UK Prototype Kit and GOV.UK Design System.
Also has mapping using OpenLayers integrated into the journey.

**Frameworks & Tools:**
- GOV.UK Prototype Kit (v13+)
- GOV.UK Design System components/macros
- Nunjucks templates
- Node.js + Express routing

**Code Style Rules:**
- Always use GOV.UK CSS classes (`govuk-form-group`, `govuk-input`, etc.)
- Prefer macros:
  - {{ govukInput({...}) }}
  - {{ govukSelect({...}) }}
  - {{ govukTextarea({...}) }}
  - {{ govukButton({...}) }}
- Each page must extend `layout.html`.
- Use `{% block pageTitle %}` and `{% block content %}`.
- Validation handled via route middleware (req.body parsing).
- Generate Express routes in `/app/routes/forms.js`.

**Template Convention Example:**

{% raw %}
{% extends "layouts/main.html" %}
{% block pageTitle %}Example Form – GOV.UK{% endblock %}
{% block content %}
<form class="govuk-form-group" method="post" action="/next-step">
  {{ govukInput({
    id: "site-name",
    name: "siteName",
    label: { text: "Site name" }
  }) }}
  {{ govukSelect({
    id: "habitat",
    name: "habitatType",
    label: { text: "Habitat type" },
    items: [
      { value: "grassland", text: "Grassland" },
      { value: "woodland", text: "Woodland" },
      { value: "wetland", text: "Wetland" }
    ]
  }) }}
  {{ govukButton({ text: "Continue" }) }}
</form>
{% endblock %}
{% endraw %}


**Output Files:**
- `/app/views/forms/[form-name].njk`
- `/app/routes.js` to add a new route to fetch the corresponding form using router.get

When you enter http://localhost:3000/start in a browser, the browser sends a request to the server - the Prototype Kit. The kit processes that request and sends a response.

The kit looks in the app/views folder for a file called start.html. It adds the GOV.UK header and footer, and sends the whole start page back as a response to the browser.

If the kit cannot find start.html in app/views, it will send an 'Error: not found' page instead.

## Client side JavaScript
Any JavaScript required to enable browser functionality should be put in `app/assets/javascripts` and referenced in the 
Nunjucks template accordingly using the path `public/javascripts`. 

## Styling
The project uses SASS for styling, and page specific styles should be placed in `app/assets/sass/application.scss` or referenced here using an import declaration. 

## Prototype API end-points approach
Edit the file:
- app/routes.js

Append new API routes using the code convention as an example:
```javascript
router.post('/live-in-uk-answer', function(request, response) {

    var liveInUK = request.session.data['live-in-uk']
    if (liveInUK === "Yes"){
        response.redirect("/next-question")
    } else {
        response.redirect("/ineligible")
    }
});
```