from pydantic import BaseModel
from typing import Literal


class FieldDefinition(BaseModel):
    column: str
    filter_tier: Literal["basic", "advanced"] | None = None
    type: Literal["date", "datetime", "time", "text", "enum", "boolean", "integer", "json_array"]
    enum_source: dict | str | list | None = None
    aggregate: str | None = None
    operators: list[str]
    filterable: bool = True
    selectable: bool = True
    join: str | None = None
    filter_strategy: Literal["where", "exists"] = "where"
    filter_group: str | None = None
    requires_permission: str | None = None
    label: str
    render_as: Literal["text", "link", "date", "datetime", "time", "badge", "outcomes_list", "fiscal_notes_list", "sponsors_list", "keywords_list", "tags_list", "agenda_items_list", "actions_list"] = "text"
    link_template: str | None = None
    


class JoinDefinition(BaseModel):
    entity: str
    on: str
    join_type: Literal["LEFT", "INNER"] = "LEFT"
    depends_on: str | None = None
    fixed_conditions: list[str] = []
    alias: str | None = None


class ReportDefinition(BaseModel):
    label: str
    base_entity: str
    base_conditions: list[str] = []
    joins: dict[str, JoinDefinition] = {}
    fields: dict[str, FieldDefinition]
    default_columns: list[str]
    related_entities: list[str]


ENTITY_TABLE: dict[str, str] = {
    "Bill": "bills",
    "Hearing": "hearings",
    "AgendaItem": "agenda_items",
    "HearingAgendaVersion": "hearing_agenda_versions",
    "CommitteeHearing": "committee_hearings",
    "BillEvent": "bill_events",
    "BillEventOutcome": "bill_event_outcomes",
    "FiscalNote": "fiscal_notes",
    "BillSponsor": "bill_sponsors",
    "BillKeyword": "bill_keywords",
    "BillTag": "bill_tags",
    "Tag": "tags",
    "Workflow": "workflows",
    "WorkflowAction": "workflow_actions",
    "BillTrackingRequest": "bill_tracking_requests",
    "HearingAssignment": "hearing_assignments",
    "User": "users",
}


REPORTS: dict[str, ReportDefinition] = {
    "bills": ReportDefinition(
        label="Bills",
        base_entity="Bill",
        joins={
            "agenda_items": JoinDefinition(
                entity="AgendaItem",
                on="agenda_items.bill_id = bills.id",
                join_type="LEFT",
            ),
            "hearing_agenda_versions": JoinDefinition(
                entity="HearingAgendaVersion",
                on="hearing_agenda_versions.id = agenda_items.agenda_version_id",
                join_type="LEFT",
                depends_on="agenda_items",
                fixed_conditions=["hearing_agenda_versions.is_current = TRUE"],
            ),
            "hearings": JoinDefinition(
                entity="Hearing",
                on="hearings.id = hearing_agenda_versions.hearing_id",
                join_type="LEFT",
                depends_on="hearing_agenda_versions",
            ),
            "bill_events": JoinDefinition(
                entity="BillEvent",
                on="bill_events.bill_id = bills.id AND bill_events.is_active = TRUE",
                join_type="LEFT",
            ),
            "bill_event_outcomes": JoinDefinition(
                entity="BillEventOutcome",
                on="bill_event_outcomes.event_id = bill_events.id",
                join_type="LEFT",
                depends_on="bill_events",
            ),
            "fiscal_notes": JoinDefinition(
                entity="FiscalNote",
                on="fiscal_notes.bill_id = bills.id AND fiscal_notes.is_active = TRUE",
                join_type="LEFT",
            ),
            "bill_sponsors": JoinDefinition(
                entity="BillSponsor",
                on="bill_sponsors.bill_id = bills.id",
                join_type="LEFT",
            ),
            "bill_keywords": JoinDefinition(
                entity="BillKeyword",
                on="bill_keywords.bill_id = bills.id",
                join_type="LEFT",
            ),
            "bill_tags": JoinDefinition(
                entity="BillTag",
                on="bill_tags.bill_id = bills.id",
                join_type="LEFT",
            ),
            "tags": JoinDefinition(
                entity="Tag",
                on="tags.id = bill_tags.tag_id AND tags.is_active = TRUE",
                join_type="LEFT",
                depends_on="bill_tags",
            ),
        },
        fields={
            "id": FieldDefinition(
                column="bills.id",
                type="integer",
                operators=[],
                filterable=False,
                selectable=True,
                label="ID",
                render_as="text",
            ),
            "bill_number": FieldDefinition(
                column="bills.bill_number",
                filter_tier="advanced",
                type="text",
                operators=["contains", "starts_with", "equals"],
                filterable=True,
                selectable=True,
                label="Bill Number",
                render_as="text",
            ),
            "introduced_date": FieldDefinition(
                column="bills.introduced_date",
                filter_tier="advanced",
                type="date",
                operators=["between", "before", "after", "equals"],
                filterable=True,
                selectable=True,
                label="Introduced Date",
                render_as="date",
            ),
            "session": FieldDefinition(
                column="bills.session",
                filter_tier="advanced",
                type="enum",
                enum_source={"table": "bills", "value_col": "session", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                label="Session",
                render_as="text",
            ),
            "title": FieldDefinition(
                column="bills.title",
                filter_tier="advanced",
                type="text",
                operators=["contains", "starts_with", "equals"],
                filterable=True,
                selectable=True,
                label="Title",
                render_as="text",
            ),
            "short_title": FieldDefinition(
                column="bills.short_title",
                filter_tier="advanced",
                type="text",
                operators=["contains", "starts_with", "equals"],
                filterable=True,
                selectable=True,
                label="Short Title",
                render_as="text",
            ),
            "status": FieldDefinition(
                column="bills.status",
                filter_tier="advanced",
                type="enum",
                enum_source={"table": "bills", "value_col": "status", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                label="Status",
                render_as="text",
            ),
            "is_tracked": FieldDefinition(
                column="bills.is_tracked",
                filter_tier="basic",
                type="boolean",
                operators=["equals"],
                filterable=True,
                selectable=True,
                label="Is Tracked",
                render_as="text",
            ),
            "last_sync": FieldDefinition(
                column="bills.last_sync",
                type="datetime",
                operators=["between", "before", "after", "equals"],
                filterable=False,
                selectable=True,
                label="Last Sync",
                render_as="datetime",
            ),
            "source_url": FieldDefinition(
                column="bills.source_url",
                type="text",
                operators=[],
                filterable=False,
                selectable=True,
                label="Source URL",
                render_as="link",
            ),
            "hearing_date": FieldDefinition(
                column="hearings.hearing_date",
                filter_tier="basic",
                type="date",
                operators=["between", "before", "after", "equals"],
                filterable=True,
                selectable=False,
                join="hearings",
                label="Hearing Date",
                render_as="date",
            ),
            "outcome_type": FieldDefinition(
                column="bill_event_outcomes.outcome_type",
                filter_tier="advanced",
                type="enum",
                enum_source={"table": "bill_event_outcomes", "value_col": "outcome_type", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=False,
                join="bill_event_outcomes",
                filter_strategy="exists",
                filter_group="Outcome criteria",
                label="Outcome Type",
            ),
            "outcome_committee": FieldDefinition(
                column="bill_event_outcomes.committee",
                filter_tier="advanced",
                type="enum",
                enum_source={"table": "bill_event_outcomes", "value_col": "committee", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=False,
                join="bill_event_outcomes",
                filter_strategy="exists",
                filter_group="Outcome criteria",
                label="Outcome Committee",
            ),
            "outcome_date": FieldDefinition(
                column="bill_events.event_date",
                filter_tier="advanced",
                type="date",
                operators=["between", "before", "after", "equals"],
                filterable=True,
                selectable=False,
                join="bill_event_outcomes",
                filter_strategy="exists",
                filter_group="Outcome criteria",
                label="Outcome Date",
            ),
            "sponsor_name": FieldDefinition(
                column="bill_sponsors.name",
                filter_tier="advanced",
                type="text",
                operators=["contains", "starts_with", "equals"],
                filterable=True,
                selectable=False,
                join="bill_sponsors",
                filter_strategy="exists",
                label="Sponsor",
            ),
            "fn_department": FieldDefinition(
                column="fiscal_notes.fn_department",
                filter_tier="advanced",
                type="enum",
                enum_source={"table": "fiscal_notes", "value_col": "fn_department", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=False,
                join="fiscal_notes",
                filter_strategy="exists",
                filter_group="Fiscal Note criteria",
                label="Fiscal Note Dept.",
            ),
            "fn_publish_date": FieldDefinition(
                column="fiscal_notes.publish_date",
                filter_tier="advanced",
                type="date",
                operators=["between", "before", "after", "equals"],
                filterable=True,
                selectable=False,
                join="fiscal_notes",
                filter_strategy="exists",
                filter_group="Fiscal Note criteria",
                label="Fiscal Note Date",
            ),
            "outcomes": FieldDefinition(
                column="bill_event_outcomes.id",
                type="json_array",
                aggregate="""json_agg(DISTINCT jsonb_build_object(
                    'outcome_type', bill_event_outcomes.outcome_type,
                    'committee',    bill_event_outcomes.committee,
                    'chamber',      bill_event_outcomes.chamber,
                    'description',  bill_event_outcomes.description,
                    'date',         bill_events.event_date,
                    'source_url',   bill_events.source_url,
                    'ai_generated', bill_event_outcomes.ai_generated
                )) FILTER (WHERE bill_event_outcomes.id IS NOT NULL)""",
                join="bill_event_outcomes",
                operators=[],
                filterable=False,
                selectable=True,
                label="Outcomes",
                render_as="outcomes_list",
            ),
            "fiscal_notes": FieldDefinition(
                column="fiscal_notes.id",
                type="json_array",
                aggregate="""json_agg(DISTINCT jsonb_build_object(
                    'fn_department',     fiscal_notes.fn_department,
                    'fn_appropriation',  fiscal_notes.fn_appropriation,
                    'fn_allocation',     fiscal_notes.fn_allocation,
                    'fn_identifier',     fiscal_notes.fn_identifier,
                    'publish_date',      fiscal_notes.publish_date,
                    'control_code',      fiscal_notes.control_code
                )) FILTER (WHERE fiscal_notes.id IS NOT NULL)""",
                join="fiscal_notes",
                operators=[],
                filterable=False,
                selectable=True,
                label="Fiscal Notes",
                render_as="fiscal_notes_list",
            ),
            "sponsors": FieldDefinition(
                column="bill_sponsors.id",
                type="json_array",
                aggregate="""json_agg(DISTINCT jsonb_build_object(
                    'name',         bill_sponsors.name,
                    'chamber',      bill_sponsors.chamber,
                    'sponsor_type', bill_sponsors.sponsor_type
                )) FILTER (WHERE bill_sponsors.id IS NOT NULL)""",
                join="bill_sponsors",
                operators=[],
                filterable=False,
                selectable=True,
                label="Sponsors",
                render_as="sponsors_list",
            ),
            "keywords": FieldDefinition(
                column="bill_keywords.id",
                type="json_array",
                aggregate="""json_agg(DISTINCT jsonb_build_object(
                    'keyword', bill_keywords.keyword,
                    'url',     bill_keywords.url
                )) FILTER (WHERE bill_keywords.id IS NOT NULL)""",
                join="bill_keywords",
                operators=[],
                filterable=False,
                selectable=True,
                label="Keywords",
                render_as="keywords_list",
            ),
            "tags": FieldDefinition(
                column="tags.id",
                type="json_array",
                aggregate="""json_agg(DISTINCT jsonb_build_object(
                    'id',    tags.id,
                    'label', tags.label
                )) FILTER (WHERE tags.id IS NOT NULL)""",
                join="tags",
                operators=[],
                filterable=False,
                selectable=True,
                label="Tags",
                render_as="tags_list",
                requires_permission="bill-tags:view",
            ),
        },
        default_columns=["bill_number", "title", "session"],
        related_entities=["Hearing", "Bill"],
    ),
    "hearings": ReportDefinition(
        label="Hearings",
        base_entity="Hearing",
        joins={
            "committee_hearings": JoinDefinition(
                entity="CommitteeHearing",
                on="committee_hearings.hearing_id = hearings.id",
                join_type="LEFT",
            ),
            "hearing_agenda_versions": JoinDefinition(
                entity="HearingAgendaVersion",
                on="hearing_agenda_versions.hearing_id = hearings.id",
                join_type="LEFT",
                fixed_conditions=["hearing_agenda_versions.is_current = TRUE"],
            ),
            "agenda_items": JoinDefinition(
                entity="AgendaItem",
                on="agenda_items.agenda_version_id = hearing_agenda_versions.id",
                join_type="LEFT",
                depends_on="hearing_agenda_versions",
            ),
            "bills": JoinDefinition(
                entity="Bill",
                on="bills.id = agenda_items.bill_id",
                join_type="LEFT",
                depends_on="agenda_items",
            ),
            "hearing_assignments": JoinDefinition(
                entity="HearingAssignment",
                on="hearing_assignments.hearing_id = hearings.id",
                join_type="LEFT",
            ),
        },
        fields={
            "id": FieldDefinition(
                column="hearings.id",
                type="integer",
                operators=[],
                filterable=False,
                selectable=True,
                label="ID",
                render_as="text",
            ),
            "hearing_date": FieldDefinition(
                column="hearings.hearing_date",
                filter_tier="basic",
                type="date",
                operators=["between", "before", "after", "equals"],
                filterable=True,
                selectable=True,
                label="Hearing Date",
                render_as="date",
            ),
            "hearing_time": FieldDefinition(
                column="hearings.hearing_time",
                type="time",
                operators=[],
                filterable=False,
                selectable=True,
                label="Time",
                render_as="time",
            ),
            "chamber": FieldDefinition(
                column="hearings.chamber",
                filter_tier="basic",
                type="enum",
                enum_source={"table": "hearings", "value_col": "chamber", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                label="Chamber",
                render_as="text",
            ),
            "hearing_type": FieldDefinition(
                column="hearings.hearing_type",
                filter_tier="advanced",
                type="enum",
                enum_source={"table": "hearings", "value_col": "hearing_type", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                label="Type",
                render_as="text",
            ),
            "location": FieldDefinition(
                column="hearings.location",
                filter_tier="advanced",
                type="text",
                operators=["contains", "equals"],
                filterable=True,
                selectable=True,
                label="Location",
                render_as="text",
            ),
            "legislature_session": FieldDefinition(
                column="hearings.legislature_session",
                filter_tier="basic",
                type="enum",
                enum_source={"table": "hearings", "value_col": "legislature_session", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                label="Session",
                render_as="text",
            ),
            "is_active": FieldDefinition(
                column="hearings.is_active",
                filter_tier="advanced",
                type="boolean",
                operators=["equals"],
                filterable=True,
                selectable=True,
                label="Is Active",
                render_as="text",
            ),
            "hidden": FieldDefinition(
                column="hearings.hidden",
                filter_tier="advanced",
                type="boolean",
                operators=["equals"],
                filterable=True,
                selectable=True,
                label="Hidden",
                render_as="text",
                requires_permission="hearing:hide",
            ),
            "dps_notes": FieldDefinition(
                column="hearings.dps_notes",
                filter_tier="advanced",
                type="text",
                operators=["contains", "equals", "is_empty", "is_not_empty"],
                filterable=True,
                selectable=True,
                label="Notes",
                render_as="text",
                requires_permission="hearing-notes:view",
            ),
            "last_sync": FieldDefinition(
                column="hearings.last_sync",
                type="datetime",
                operators=[],
                filterable=False,
                selectable=True,
                label="Last Sync",
                render_as="datetime",
            ),
            "committee_name": FieldDefinition(
                column="committee_hearings.committee_name",
                filter_tier="advanced",
                type="text",
                operators=["contains", "starts_with", "equals"],
                filterable=True,
                selectable=True,
                join="committee_hearings",
                label="Committee",
                render_as="text",
            ),
            "committee_type": FieldDefinition(
                column="committee_hearings.committee_type",
                filter_tier="advanced",
                type="text",
                operators=["contains", "equals"],
                filterable=True,
                selectable=True,
                join="committee_hearings",
                label="Committee Type",
                render_as="text",
            ),
            "committee_url": FieldDefinition(
                column="committee_hearings.committee_url",
                type="text",
                operators=[],
                filterable=False,
                selectable=True,
                join="committee_hearings",
                label="Committee URL",
                render_as="link",
            ),
            "agenda_items": FieldDefinition(
                column="agenda_items.id",
                type="json_array",
                aggregate="""json_agg(DISTINCT jsonb_build_object(
                    'id',               agenda_items.id,
                    'bill_number',      agenda_items.bill_number,
                    'content',          agenda_items.content,
                    'url',              agenda_items.url,
                    'prefix',           agenda_items.prefix,
                    'is_bill',          agenda_items.is_bill,
                    'is_teleconferenced', agenda_items.is_teleconferenced,
                    'sort_order',       agenda_items.sort_order
                )) FILTER (WHERE agenda_items.id IS NOT NULL)""",
                join="agenda_items",
                operators=[],
                filterable=False,
                selectable=True,
                label="Agenda Items",
                render_as="agenda_items_list",
            ),
            "bill_count": FieldDefinition(
                column="agenda_items.bill_id",
                type="integer",
                aggregate="COUNT(DISTINCT agenda_items.bill_id) FILTER (WHERE agenda_items.is_bill = TRUE)",
                join="agenda_items",
                operators=[],
                filterable=False,
                selectable=True,
                label="Bill Count",
                render_as="text",
            ),
            "agenda_bill_number": FieldDefinition(
                column="agenda_items.bill_number",
                filter_tier="basic",
                type="text",
                operators=["contains", "equals"],
                filterable=True,
                selectable=False,
                join="agenda_items",
                filter_strategy="exists",
                label="Bill on Agenda",
            ),
            "hearing_assignments_summary": FieldDefinition(
                column="hearing_assignments.id",
                type="json_array",
                aggregate="""json_agg(DISTINCT jsonb_build_object(
                    'id',                  hearing_assignments.id,
                    'workflow_id',         hearing_assignments.workflow_id,
                    'assignee_email',      (SELECT email FROM users WHERE id = hearing_assignments.assignee_id),
                    'bill_number',         (SELECT bill_number FROM bills b2 WHERE b2.id = hearing_assignments.bill_id),
                    'latest_action_type',  (SELECT type FROM workflow_actions wa
                                            WHERE wa.workflow_id = hearing_assignments.workflow_id
                                            ORDER BY wa.action_timestamp DESC LIMIT 1)
                )) FILTER (WHERE hearing_assignments.id IS NOT NULL)""",
                join="hearing_assignments",
                operators=[],
                filterable=False,
                selectable=True,
                label="Hearing Assignments",
                render_as="text",
                requires_permission="hearing-assignment:view",
            ),
            "has_tracked_bill_without_assignment": FieldDefinition(
                column=(
                    "EXISTS ("
                    "  SELECT 1 FROM agenda_items ai2"
                    "  JOIN hearing_agenda_versions hav2"
                    "    ON hav2.id = ai2.agenda_version_id AND hav2.is_current = TRUE AND hav2.hearing_id = hearings.id"
                    "  JOIN bills b3 ON b3.id = ai2.bill_id AND b3.is_tracked = TRUE AND ai2.is_bill = TRUE"
                    "  WHERE NOT EXISTS ("
                    "    SELECT 1 FROM hearing_assignments ha2"
                    "    WHERE ha2.hearing_id = hearings.id AND ha2.bill_id = ai2.bill_id"
                    "    AND (SELECT type FROM workflow_actions wa2"
                    "         WHERE wa2.workflow_id = ha2.workflow_id"
                    "         ORDER BY wa2.action_timestamp DESC LIMIT 1)"
                    "    IN ('hearing_assigned', 'hearing_assignment_complete',"
                    "        'reassignment_request', 'auto_suggested_hearing_assignment')"
                    "  )"
                    ")"
                ),
                filter_tier="advanced",
                type="boolean",
                operators=["equals"],
                filterable=True,
                selectable=False,
                label="Has Tracked Bill Without Assignment",
            ),
        },
        default_columns=["hearing_date", "chamber", "committee_name", "hearing_type", "location"],
        related_entities=["Hearing", "Bill"],
    ),
    "requests": ReportDefinition(
        label="Bill Tracking Requests",
        base_entity="Workflow",
        base_conditions=["workflows.type = 'request_bill_tracking'"],
        joins={
            "bill_tracking_request": JoinDefinition(
                entity="BillTrackingRequest",
                on="bill_tracking_requests.workflow_id = workflows.id",
                join_type="INNER",
            ),
            "bill": JoinDefinition(
                entity="Bill",
                on="bills.id = bill_tracking_requests.bill_id",
                join_type="LEFT",
                depends_on="bill_tracking_request",
            ),
            "creator": JoinDefinition(
                entity="User",
                on="creator.id = workflows.created_by",
                join_type="LEFT",
                alias="creator",
            ),
            "workflow_actions": JoinDefinition(
                entity="WorkflowAction",
                on="workflow_actions.workflow_id = workflows.id",
                join_type="LEFT",
            ),
        },
        fields={
            "id": FieldDefinition(
                column="workflows.id",
                type="integer",
                operators=["equals"],
                filterable=True,
                selectable=True,
                label="ID",
                render_as="text",
            ),
            "workflow_status": FieldDefinition(
                column="workflows.status",
                filter_tier="basic",
                type="enum",
                enum_source=["open", "closed"],
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                label="Status",
                render_as="badge",
            ),
            "created_at": FieldDefinition(
                column="workflows.created_at",
                filter_tier="advanced",
                type="datetime",
                operators=["before", "after", "between"],
                filterable=True,
                selectable=True,
                label="Requested On",
                render_as="datetime",
            ),
            "updated_at": FieldDefinition(
                column="workflows.updated_at",
                filter_tier="advanced",
                type="datetime",
                operators=["before", "after", "between"],
                filterable=True,
                selectable=True,
                label="Last Updated",
                render_as="datetime",
            ),
            "created_by": FieldDefinition(
                column="workflows.created_by",
                type="integer",
                operators=["equals"],
                filterable=True,
                selectable=False,
                label="Created By",
                render_as="text",
            ),
            "requestor_email": FieldDefinition(
                column="creator.email",
                filter_tier="advanced",
                type="text",
                operators=["contains", "equals", "starts_with"],
                filterable=True,
                selectable=True,
                join="creator",
                label="Requested By",
                render_as="text",
            ),
            "bill_id": FieldDefinition(
                column="bill_tracking_requests.bill_id",
                type="integer",
                operators=[],
                filterable=False,
                selectable=True,
                join="bill_tracking_request",
                label="Bill ID",
                render_as="text",
            ),
            "bill_number": FieldDefinition(
                column="bills.bill_number",
                filter_tier="basic",
                type="text",
                operators=["contains", "starts_with", "equals"],
                filterable=True,
                selectable=True,
                join="bill",
                label="Bill Number",
                render_as="text",
            ),
            "bill_short_title": FieldDefinition(
                column="bills.short_title",
                filter_tier="advanced",
                type="text",
                operators=["contains", "is_empty", "is_not_empty"],
                filterable=True,
                selectable=True,
                join="bill",
                label="Bill Title",
                render_as="text",
            ),
            "bill_session": FieldDefinition(
                column="bills.session",
                filter_tier="advanced",
                type="integer",
                enum_source=(
                    "SELECT DISTINCT bills.session"
                    " FROM bills"
                    " JOIN bill_tracking_requests ON bill_tracking_requests.bill_id = bills.id"
                    " JOIN workflows ON workflows.id = bill_tracking_requests.workflow_id"
                    " WHERE workflows.type = 'request_bill_tracking'"
                    " ORDER BY bills.session DESC"
                ),
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                join="bill",
                label="Session",
                render_as="text",
            ),
            "bill_is_tracked": FieldDefinition(
                column="bills.is_tracked",
                filter_tier="advanced",
                type="boolean",
                operators=["equals"],
                filterable=True,
                selectable=True,
                join="bill",
                label="Tracking Approved",
                render_as="badge",
            ),
            "latest_action_type": FieldDefinition(
                column=(
                    "(SELECT type FROM workflow_actions wa"
                    " WHERE wa.workflow_id = workflows.id"
                    " ORDER BY wa.action_timestamp DESC LIMIT 1)"
                ),
                filter_tier="basic",
                type="enum",
                enum_source=["request_bill_tracking", "approve_bill_tracking", "deny_bill_tracking"],
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                label="Outcome",
                render_as="badge",
            ),
            "bill_status": FieldDefinition(
                column="bills.status",
                filter_tier="advanced",
                type="text",
                operators=["contains", "equals", "is_empty", "is_not_empty"],
                filterable=True,
                selectable=True,
                join="bill",
                label="Bill Status",
                render_as="text",
            ),
            "bill_url": FieldDefinition(
                column="bills.source_url",
                type="text",
                operators=[],
                filterable=False,
                selectable=True,
                join="bill",
                label="Bill URL",
                render_as="link",
            ),
            "action_count": FieldDefinition(
                column="workflow_actions.id",
                type="integer",
                aggregate="COUNT(workflow_actions.id)",
                join="workflow_actions",
                operators=[],
                filterable=False,
                selectable=True,
                label="Action Count",
                render_as="text",
            ),
            "actions": FieldDefinition(
                column="workflow_actions.id",
                type="json_array",
                aggregate=(
                    "json_agg(json_build_object("
                    "'type', workflow_actions.type,"
                    " 'actor', (SELECT email FROM users WHERE id = workflow_actions.user_id),"
                    " 'at', workflow_actions.action_timestamp"
                    ") ORDER BY workflow_actions.action_timestamp)"
                    " FILTER (WHERE workflow_actions.id IS NOT NULL)"
                ),
                join="workflow_actions",
                operators=[],
                filterable=False,
                selectable=True,
                label="Actions",
                render_as="actions_list",
            ),
        },
        default_columns=["bill_number", "bill_short_title", "workflow_status", "created_at", "requestor_email", "bill_is_tracked"],
        related_entities=["Workflow", "Bill"],
    ),
    "hearing_assignments": ReportDefinition(
        label="Hearing Assignments",
        base_entity="HearingAssignment",
        joins={
            "workflow": JoinDefinition(
                entity="Workflow",
                on="workflows.id = hearing_assignments.workflow_id",
                join_type="INNER",
            ),
            "assignee_user": JoinDefinition(
                entity="User",
                on="assignee_user.id = hearing_assignments.assignee_id",
                join_type="LEFT",
                alias="assignee_user",
            ),
            "hearing": JoinDefinition(
                entity="Hearing",
                on="hearings.id = hearing_assignments.hearing_id",
                join_type="LEFT",
            ),
            "committee_hearings": JoinDefinition(
                entity="CommitteeHearing",
                on="committee_hearings.hearing_id = hearings.id",
                join_type="LEFT",
                depends_on="hearing",
            ),
            "bill": JoinDefinition(
                entity="Bill",
                on="bills.id = hearing_assignments.bill_id",
                join_type="LEFT",
            ),
            "workflow_actions": JoinDefinition(
                entity="WorkflowAction",
                on="workflow_actions.workflow_id = workflows.id",
                join_type="LEFT",
                depends_on="workflow",
            ),
        },
        fields={
            "id": FieldDefinition(
                column="hearing_assignments.id",
                type="integer",
                operators=[],
                filterable=False,
                selectable=True,
                label="ID",
                render_as="text",
            ),
            "workflow_id": FieldDefinition(
                column="hearing_assignments.workflow_id",
                type="integer",
                operators=[],
                filterable=False,
                selectable=True,
                join="workflow",
                label="Workflow ID",
                render_as="text",
            ),
            "workflow_status": FieldDefinition(
                column="workflows.status",
                filter_tier="basic",
                type="enum",
                enum_source=["open", "closed"],
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                join="workflow",
                label="Workflow Status",
                render_as="badge",
            ),
            "latest_action_type": FieldDefinition(
                column=(
                    "(SELECT type FROM workflow_actions wa"
                    " WHERE wa.workflow_id = hearing_assignments.workflow_id"
                    " ORDER BY wa.action_timestamp DESC LIMIT 1)"
                ),
                filter_tier="basic",
                type="enum",
                enum_source=[
                    "auto_suggested_hearing_assignment",
                    "hearing_assigned",
                    "reassignment_request",
                    "hearing_assignment_complete",
                    "hearing_assignment_canceled",
                    "hearing_assignment_discarded",
                ],
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                label="Assignment Status",
                render_as="badge",
            ),
            "assignee_email": FieldDefinition(
                column="assignee_user.email",
                filter_tier="basic",
                type="text",
                operators=["contains", "equals", "starts_with"],
                filterable=True,
                selectable=True,
                join="assignee_user",
                label="Assignee",
                render_as="text",
            ),
            "hearing_id": FieldDefinition(
                column="hearing_assignments.hearing_id",
                type="integer",
                operators=["equals"],
                filterable=True,
                selectable=True,
                label="Hearing ID",
                render_as="text",
            ),
            "hearing_date": FieldDefinition(
                column="hearings.hearing_date",
                filter_tier="basic",
                type="date",
                operators=["between", "before", "after", "equals"],
                filterable=True,
                selectable=True,
                join="hearing",
                label="Hearing Date",
                render_as="date",
            ),
            "hearing_time": FieldDefinition(
                column="hearings.hearing_time",
                type="time",
                operators=[],
                filterable=False,
                selectable=True,
                join="hearing",
                label="Hearing Time",
                render_as="time",
            ),
            "hearing_chamber": FieldDefinition(
                column="hearings.chamber",
                filter_tier="advanced",
                type="enum",
                enum_source={"table": "hearings", "value_col": "chamber", "distinct": True},
                operators=["equals", "in"],
                filterable=True,
                selectable=True,
                join="hearing",
                label="Chamber",
                render_as="text",
            ),
            "committee_name": FieldDefinition(
                column="committee_hearings.committee_name",
                filter_tier="advanced",
                type="text",
                operators=["contains", "starts_with", "equals"],
                filterable=True,
                selectable=True,
                join="committee_hearings",
                label="Committee",
                render_as="text",
            ),
            "bill_number": FieldDefinition(
                column="bills.bill_number",
                filter_tier="basic",
                type="text",
                operators=["contains", "starts_with", "equals"],
                filterable=True,
                selectable=True,
                join="bill",
                label="Bill Number",
                render_as="text",
            ),
            "bill_short_title": FieldDefinition(
                column="bills.short_title",
                filter_tier="advanced",
                type="text",
                operators=["contains", "is_empty", "is_not_empty"],
                filterable=True,
                selectable=True,
                join="bill",
                label="Bill Title",
                render_as="text",
            ),
            "created_at": FieldDefinition(
                column="workflows.created_at",
                filter_tier="advanced",
                type="datetime",
                operators=["before", "after", "between"],
                filterable=True,
                selectable=True,
                join="workflow",
                label="Created On",
                render_as="datetime",
            ),
            "actions": FieldDefinition(
                column="workflow_actions.id",
                type="json_array",
                aggregate=(
                    "json_agg(json_build_object("
                    "'type', workflow_actions.type,"
                    " 'actor', (SELECT email FROM users WHERE id = workflow_actions.user_id),"
                    " 'at', workflow_actions.action_timestamp"
                    ") ORDER BY workflow_actions.action_timestamp)"
                    " FILTER (WHERE workflow_actions.id IS NOT NULL)"
                ),
                join="workflow_actions",
                operators=[],
                filterable=False,
                selectable=True,
                label="Actions",
                render_as="actions_list",
            ),
            "sort_priority": FieldDefinition(
                column=(
                    "CASE"
                    " WHEN (SELECT type FROM workflow_actions wa"
                    "       WHERE wa.workflow_id = hearing_assignments.workflow_id"
                    "       ORDER BY wa.action_timestamp DESC LIMIT 1)"
                    "      = 'auto_suggested_hearing_assignment' THEN 1"
                    " WHEN (SELECT type FROM workflow_actions wa"
                    "       WHERE wa.workflow_id = hearing_assignments.workflow_id"
                    "       ORDER BY wa.action_timestamp DESC LIMIT 1)"
                    "      IN ('hearing_assigned', 'reassignment_request') THEN 2"
                    " ELSE 3 END"
                ),
                type="integer",
                operators=[],
                filterable=False,
                selectable=False,
                join="workflow",
                label="Sort Priority",
                render_as="text",
            ),
        },
        default_columns=["latest_action_type", "assignee_email", "bill_number", "hearing_date", "committee_name"],
        related_entities=["HearingAssignment", "Workflow", "Hearing", "Bill"],
    ),
}
