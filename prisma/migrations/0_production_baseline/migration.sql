-- Baseline of existing ats/mass_mail structure; includes shared parser objects.
-- Existing databases must mark this migration applied, never replay it.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET LOCAL idle_in_transaction_session_timeout = 0;
SET LOCAL client_encoding = 'UTF8';
SET LOCAL standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', true);
SET LOCAL check_function_bodies = false;
SET LOCAL xmloption = content;
SET LOCAL client_min_messages = warning;
SET LOCAL row_security = off;

--
-- Name: ats; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS ats;


--
-- Name: mass_mail; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS mass_mail;


--
-- Name: text_eq_uuid(text, uuid); Type: FUNCTION; Schema: ats; Owner: -
--

CREATE FUNCTION ats.text_eq_uuid(text, uuid) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$ SELECT $1::uuid = $2; $_$;


--
-- Name: uuid_eq_text(uuid, text); Type: FUNCTION; Schema: ats; Owner: -
--

CREATE FUNCTION ats.uuid_eq_text(uuid, text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$ SELECT $1 = $2::uuid; $_$;


--
-- Name: =; Type: OPERATOR; Schema: ats; Owner: -
--

CREATE OPERATOR ats.= (
    FUNCTION = ats.text_eq_uuid,
    LEFTARG = text,
    RIGHTARG = uuid
);


--
-- Name: =; Type: OPERATOR; Schema: ats; Owner: -
--

CREATE OPERATOR ats.= (
    FUNCTION = ats.uuid_eq_text,
    LEFTARG = uuid,
    RIGHTARG = text
);


SET LOCAL default_tablespace = '';

SET LOCAL default_table_access_method = heap;

--
-- Name: _BranchManagers; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats."_BranchManagers" (
    "A" uuid NOT NULL,
    "B" uuid NOT NULL
);


--
-- Name: _BusinessUnitAdmins; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats."_BusinessUnitAdmins" (
    "A" uuid NOT NULL,
    "B" uuid NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    actor_id character varying(255) NOT NULL,
    actor_email character varying(255),
    action character varying(100) NOT NULL,
    target_type character varying(100),
    target_id character varying(255),
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip_address character varying(100),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: branches; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50),
    city character varying(100),
    state character varying(100),
    country character varying(100) DEFAULT 'India'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    market character varying(50) DEFAULT 'INDIA'::character varying NOT NULL,
    allow_none boolean DEFAULT false NOT NULL,
    allow_pods boolean DEFAULT true NOT NULL,
    allow_all boolean DEFAULT true NOT NULL,
    allow_unassigned boolean DEFAULT true NOT NULL,
    pod_distribution_strategy character varying(50) DEFAULT 'AUTO'::character varying NOT NULL,
    require_am_job_approval boolean DEFAULT true NOT NULL,
    require_job_approval boolean DEFAULT true NOT NULL,
    roles_requiring_approval text,
    default_job_approver_role character varying(50) DEFAULT 'POD_LEAD'::character varying,
    allowed_job_approver_roles text,
    approval_routing_mode character varying(50) DEFAULT 'FLEXIBLE'::character varying,
    timezone character varying(100) DEFAULT 'Asia/Kolkata'::character varying,
    work_start_time character varying(20) DEFAULT '09:00'::character varying,
    work_end_time character varying(20) DEFAULT '18:00'::character varying,
    working_days text,
    shift_timing character varying(100) DEFAULT 'General Shift'::character varying,
    break_duration_minutes integer DEFAULT 60,
    enable_global_remarks boolean DEFAULT false NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    selected_global_remark_ids text DEFAULT 'ALL'::text
);


--
-- Name: bulk_upload_items; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.bulk_upload_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bulk_upload_id uuid NOT NULL,
    filename character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'queued'::character varying NOT NULL,
    error_message text,
    candidate_id uuid,
    candidate_name character varying(255),
    candidate_email character varying(255),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: bulk_uploads; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.bulk_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    created_by character varying(255) NOT NULL,
    total_files integer DEFAULT 0 NOT NULL,
    processed_files integer DEFAULT 0 NOT NULL,
    failed_files integer DEFAULT 0 NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: business_units; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.business_units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    code character varying(50),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    branch_id uuid,
    shift_timing character varying(100) DEFAULT 'General Shift'::character varying,
    timezone character varying(100) DEFAULT 'Asia/Kolkata'::character varying,
    work_end_time character varying(20) DEFAULT '18:00'::character varying,
    work_start_time character varying(20) DEFAULT '09:00'::character varying,
    break_duration_minutes integer DEFAULT 60,
    working_days text[] DEFAULT ARRAY['Monday'::text, 'Tuesday'::text, 'Wednesday'::text, 'Thursday'::text, 'Friday'::text],
    allow_all boolean DEFAULT true NOT NULL,
    allow_none boolean DEFAULT false NOT NULL,
    allow_pods boolean DEFAULT true NOT NULL,
    allow_unassigned boolean DEFAULT true NOT NULL,
    pod_distribution_strategy character varying(50) DEFAULT 'AUTO'::character varying NOT NULL,
    job_code_pattern character varying(200),
    market_segment_id uuid,
    address character varying(500),
    city character varying(100),
    state character varying(100),
    zip_code character varying(20)
);


--
-- Name: candidate_education; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.candidate_education (
    id integer NOT NULL,
    candidate_id integer,
    degree_id integer,
    raw_degree character varying,
    institution_name character varying,
    start_year integer,
    end_year integer
);


--
-- Name: candidate_education_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.candidate_education_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidate_education_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.candidate_education_id_seq OWNED BY ats.candidate_education.id;


--
-- Name: candidate_experience; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.candidate_experience (
    id integer NOT NULL,
    candidate_id integer,
    company_id integer,
    raw_company_name character varying,
    designation_id integer,
    raw_designation character varying,
    start_date date,
    end_date date,
    currently_working boolean
);


--
-- Name: candidate_experience_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.candidate_experience_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidate_experience_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.candidate_experience_id_seq OWNED BY ats.candidate_experience.id;


--
-- Name: candidate_skills; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.candidate_skills (
    id integer NOT NULL,
    candidate_id integer,
    skill_id integer,
    years_of_experience integer
);


--
-- Name: candidate_skills_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.candidate_skills_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: candidate_skills_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.candidate_skills_id_seq OWNED BY ats.candidate_skills.id;


--
-- Name: candidates; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    branch_id uuid,
    candidate_code character varying(100),
    first_name character varying(255),
    last_name character varying(255),
    full_name character varying(255),
    email character varying(255),
    phone character varying(50),
    market character varying(50) DEFAULT 'US'::character varying NOT NULL,
    source character varying(100),
    work_authorization character varying(100),
    raw_current_location text,
    raw_current_designation text,
    total_experience_years numeric(4,1),
    relevant_experience_years numeric(4,1),
    current_ctc numeric(10,2),
    expected_ctc numeric(10,2),
    current_company character varying(255),
    availability_to_start character varying(100),
    notice_period_days integer DEFAULT 0 NOT NULL,
    serving_notice boolean DEFAULT false NOT NULL,
    last_working_day date,
    pan_card character varying(10),
    preferred_locations text[],
    skills text[] DEFAULT ARRAY[]::text[],
    resume_record_id uuid,
    uploaded_by_user_id uuid,
    uploaded_by_name character varying(255),
    deleted_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: client_contacts; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.client_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    client_id uuid NOT NULL,
    created_by uuid NOT NULL,
    name character varying(255) NOT NULL,
    designation character varying(255),
    email character varying(255),
    phone character varying(50),
    linkedin_url character varying(500),
    is_primary boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: clients; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    client_code character varying(100),
    client_name character varying(255) NOT NULL,
    contact_number character varying(100),
    website character varying(255),
    industry character varying(100),
    state character varying(100),
    city character varying(100),
    status character varying(50) DEFAULT 'Active'::character varying NOT NULL,
    category character varying(100),
    primary_owner character varying(255),
    business_unit character varying(100),
    ownership character varying(100),
    display_on_job_posting boolean DEFAULT true NOT NULL,
    created_by uuid,
    modified_by character varying(255),
    federal_id character varying(100),
    email_id character varying(255),
    fax character varying(100),
    payment_terms character varying(100),
    address text,
    client_lead character varying(255),
    postal_code character varying(50),
    country character varying(100),
    practice character varying(100),
    required_documents text,
    tag character varying(100),
    client_short_name character varying(100),
    geopolitical_zone character varying(100),
    primary_business_unit character varying(100),
    facility_management character varying(100),
    branch_id uuid,
    market character varying(50) DEFAULT 'US'::character varying NOT NULL,
    end_client_name character varying(255),
    is_same_as_primary boolean DEFAULT true NOT NULL,
    contact_person character varying(255),
    contact_designation character varying(255),
    gstin character varying(100),
    pan_number character varying(100),
    currency character varying(20) DEFAULT 'USD'::character varying NOT NULL,
    tier_rating character varying(50),
    credit_check_status character varying(50),
    fillability_score character varying(50),
    vetting_notes text,
    onboarding_status character varying(50) DEFAULT 'ACTIVE'::character varying NOT NULL,
    msa_signed boolean DEFAULT false NOT NULL,
    sow_executed boolean DEFAULT false NOT NULL,
    coi_received boolean DEFAULT false NOT NULL,
    vendor_portal_created boolean DEFAULT false NOT NULL,
    stop_notifications boolean DEFAULT false NOT NULL,
    about_company text,
    approval_status character varying(50) DEFAULT 'APPROVED'::character varying,
    assigned_approver_id uuid,
    approved_by uuid,
    approved_at timestamp(6) with time zone,
    rejection_reason text,
    deleted_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    commission_percentage numeric(5,2),
    contract_markup numeric(5,2)
);


--
-- Name: companies_master; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.companies_master (
    id integer NOT NULL,
    canonical_company_name character varying NOT NULL
);


--
-- Name: companies_master_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.companies_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: companies_master_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.companies_master_id_seq OWNED BY ats.companies_master.id;


--
-- Name: company_aliases; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.company_aliases (
    id integer NOT NULL,
    alias character varying NOT NULL,
    company_id integer
);


--
-- Name: company_aliases_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.company_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.company_aliases_id_seq OWNED BY ats.company_aliases.id;


--
-- Name: custom_roles; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.custom_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    name character varying(100) NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    base_role_id uuid,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by uuid,
    system_role_id uuid,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    business_unit_id uuid
);


--
-- Name: degree_aliases; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.degree_aliases (
    id integer NOT NULL,
    alias character varying NOT NULL,
    degree_id integer
);


--
-- Name: degree_aliases_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.degree_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: degree_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.degree_aliases_id_seq OWNED BY ats.degree_aliases.id;


--
-- Name: degrees_master; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.degrees_master (
    id integer NOT NULL,
    canonical_degree character varying NOT NULL
);


--
-- Name: degrees_master_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.degrees_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: degrees_master_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.degrees_master_id_seq OWNED BY ats.degrees_master.id;


--
-- Name: designation_aliases; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.designation_aliases (
    id integer NOT NULL,
    alias character varying NOT NULL,
    designation_id integer
);


--
-- Name: designation_aliases_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.designation_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: designation_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.designation_aliases_id_seq OWNED BY ats.designation_aliases.id;


--
-- Name: designations_master; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.designations_master (
    id integer NOT NULL,
    canonical_designation character varying NOT NULL,
    seniority_level character varying
);


--
-- Name: designations_master_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.designations_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: designations_master_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.designations_master_id_seq OWNED BY ats.designations_master.id;


--
-- Name: job_assignment_logs; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.job_assignment_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    pod_id uuid,
    assigned_by character varying(255) DEFAULT 'System'::character varying NOT NULL,
    assigned_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: job_delegation_requests; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.job_delegation_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    source_branch_id uuid NOT NULL,
    target_branch_id uuid NOT NULL,
    status character varying(50) DEFAULT 'PENDING'::character varying NOT NULL,
    sla_days_target integer,
    notes text,
    assigned_pod_id uuid,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source_unit_id uuid,
    target_unit_id uuid
);


--
-- Name: job_pods; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.job_pods (
    job_id uuid NOT NULL,
    pod_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: job_recruiters; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.job_recruiters (
    job_id uuid NOT NULL,
    recruiter_id uuid NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: jobs; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    business_unit_id uuid,
    job_code character varying(100) NOT NULL,
    job_title character varying(255) NOT NULL,
    job_type character varying(100) DEFAULT 'Full-time'::character varying NOT NULL,
    job_description text,
    skills_required text[],
    secondary_skills text[] DEFAULT ARRAY[]::text[],
    state character varying(100),
    city character varying(100),
    country character varying(100),
    client_job_id character varying(100),
    visa_type character varying(500),
    pay_rate_min numeric(10,2),
    pay_rate_max numeric(10,2),
    pay_currency character varying(10) DEFAULT 'INR'::character varying,
    pay_term character varying(50) DEFAULT 'LPA'::character varying,
    client_bill_rate_min numeric(10,2),
    client_bill_rate_max numeric(10,2),
    client_bill_currency character varying(10) DEFAULT 'INR'::character varying,
    client_bill_term character varying(50) DEFAULT 'LPA'::character varying,
    placement_commission_pct numeric(5,2),
    tax_terms character varying(100),
    client_id uuid,
    end_client_id uuid,
    end_client_poc_id uuid,
    no_of_positions integer DEFAULT 1 NOT NULL,
    submission_required integer DEFAULT 5 NOT NULL,
    submission_done integer DEFAULT 0 NOT NULL,
    urgency character varying(50) DEFAULT 'WARM'::character varying NOT NULL,
    status character varying(50) DEFAULT 'ACTIVE'::character varying NOT NULL,
    market character varying(50) DEFAULT 'US'::character varying NOT NULL,
    work_mode character varying(50) DEFAULT 'In Office'::character varying,
    start_date date,
    end_date date,
    hours_per_week integer DEFAULT 40,
    duration character varying(100),
    account_manager_id uuid,
    recruitment_manager_id uuid,
    industry character varying(100),
    degree character varying(100),
    exp_min integer DEFAULT 0,
    exp_max integer DEFAULT 10,
    respond_by date,
    notice_period character varying(100),
    approval_status character varying(50) DEFAULT 'APPROVED'::character varying,
    assigned_approver_id uuid,
    approved_by uuid,
    approved_at timestamp(6) with time zone,
    rejection_reason text,
    job_timezone character varying(100),
    shift_timing character varying(100),
    deleted_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_co_sourced boolean DEFAULT false NOT NULL,
    margin_split_am_pct integer,
    margin_split_rec_pct integer,
    shared_branch_ids text[] DEFAULT ARRAY[]::text[],
    poc_id uuid
);


--
-- Name: kv_store; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.kv_store (
    key character varying(255) NOT NULL,
    value text NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: location_aliases; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.location_aliases (
    id integer NOT NULL,
    alias character varying NOT NULL,
    location_id integer
);


--
-- Name: location_aliases_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.location_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: location_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.location_aliases_id_seq OWNED BY ats.location_aliases.id;


--
-- Name: locations_master; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.locations_master (
    id integer NOT NULL,
    canonical_location character varying NOT NULL,
    country character varying,
    state character varying
);


--
-- Name: locations_master_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.locations_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: locations_master_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.locations_master_id_seq OWNED BY ats.locations_master.id;


--
-- Name: market_segments; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.market_segments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name character varying(100) NOT NULL,
    code character varying(20) NOT NULL,
    description character varying(500),
    default_currency character varying(10) DEFAULT 'USD'::character varying NOT NULL,
    default_timezone character varying(100) DEFAULT 'America/New_York'::character varying NOT NULL,
    default_shift character varying(100) DEFAULT 'General Shift'::character varying NOT NULL,
    default_start_time character varying(20) DEFAULT '09:00'::character varying,
    default_end_time character varying(20) DEFAULT '18:00'::character varying,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    initiator_id character varying(255),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: parser_candidates; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.parser_candidates (
    id integer NOT NULL,
    full_name character varying,
    email character varying,
    phone character varying,
    current_location_id integer,
    raw_current_location character varying,
    total_experience_years integer,
    current_designation_id integer,
    raw_current_designation character varying,
    created_at timestamp without time zone,
    source character varying,
    work_authorization character varying,
    resume_record_id uuid
);


--
-- Name: parser_candidates_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.parser_candidates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: parser_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.parser_candidates_id_seq OWNED BY ats.parser_candidates.id;


--
-- Name: pending_normalizations; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.pending_normalizations (
    id integer NOT NULL,
    category character varying(50) NOT NULL,
    raw_value character varying(255) NOT NULL,
    detected_count integer DEFAULT 1 NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: pending_normalizations_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.pending_normalizations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pending_normalizations_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.pending_normalizations_id_seq OWNED BY ats.pending_normalizations.id;


--
-- Name: pods; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.pods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    branch_id uuid,
    name character varying(255) NOT NULL,
    pod_head_id uuid,
    description text,
    is_available_for_assignment boolean DEFAULT true NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    business_unit_id uuid
);


--
-- Name: recruiter_submissions; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.recruiter_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    job_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    recruiter_id character varying(255) NOT NULL,
    l1_status character varying(50) DEFAULT 'PENDING'::character varying NOT NULL,
    l1_date timestamp(6) with time zone,
    l1_remarks text,
    l1_interviewer character varying(255),
    l2_status character varying(50),
    l2_date timestamp(6) with time zone,
    l2_remarks text,
    l2_interviewer character varying(255),
    l3_status character varying(50),
    l3_date timestamp(6) with time zone,
    l3_remarks text,
    l3_interviewer character varying(255),
    meeting_link text,
    final_status character varying(50) DEFAULT 'SUBMITTED'::character varying NOT NULL,
    remarks text,
    recruiter_comment text,
    pod_lead_remarks text,
    review_feedback text,
    submitted_rate_amount numeric(10,2),
    submitted_rate_currency character varying(10) DEFAULT 'INR'::character varying,
    submitted_rate_term character varying(50) DEFAULT 'LPA'::character varying,
    candidate_current_ctc numeric(10,2),
    candidate_expected_ctc numeric(10,2),
    candidate_ctc_currency character varying(10) DEFAULT 'INR'::character varying,
    candidate_ctc_term character varying(50) DEFAULT 'LPA'::character varying,
    candidate_notice_period integer,
    candidate_relevant_experience numeric(4,1),
    candidate_preferred_locations text[] DEFAULT ARRAY[]::text[],
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: resumes; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.resumes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename character varying(255),
    candidate_name character varying(255),
    email character varying(255),
    file_hash character varying(255),
    parsed_json jsonb,
    raw_text text,
    embedding text,
    file_data bytea,
    file_mime character varying(150),
    file_size integer,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: skill_aliases; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.skill_aliases (
    id integer NOT NULL,
    skill_id integer NOT NULL,
    alias_name character varying(255) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: skill_aliases_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.skill_aliases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skill_aliases_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.skill_aliases_id_seq OWNED BY ats.skill_aliases.id;


--
-- Name: skill_categories; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.skill_categories (
    id integer NOT NULL,
    name character varying NOT NULL
);


--
-- Name: skill_categories_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.skill_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skill_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.skill_categories_id_seq OWNED BY ats.skill_categories.id;


--
-- Name: skills_master; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.skills_master (
    id integer NOT NULL,
    canonical_name character varying(255) NOT NULL,
    category character varying(100),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    category_id integer
);


--
-- Name: skills_master_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.skills_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: skills_master_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.skills_master_id_seq OWNED BY ats.skills_master.id;


--
-- Name: system_roles; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.system_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    system_key character varying(50) NOT NULL,
    description text,
    permissions jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tenant_auth_settings; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.tenant_auth_settings (
    tenant_id uuid NOT NULL,
    allow_password_login boolean DEFAULT true NOT NULL,
    allow_microsoft_sso boolean DEFAULT false NOT NULL,
    allow_google_sso boolean DEFAULT false NOT NULL,
    enforce_sso_only boolean DEFAULT false NOT NULL,
    require_mfa boolean DEFAULT false NOT NULL,
    allow_personal_emails boolean DEFAULT true NOT NULL,
    allowed_email_domains text[] DEFAULT ARRAY[]::text[],
    microsoft_tenant_id character varying(255),
    microsoft_client_id character varying(255),
    microsoft_client_secret character varying(255),
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tenant_counters; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.tenant_counters (
    tenant_id uuid NOT NULL,
    entity_type character varying(50) NOT NULL,
    current_value integer DEFAULT 0 NOT NULL
);


--
-- Name: tenant_dice_integrations; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.tenant_dice_integrations (
    tenant_id uuid NOT NULL,
    client_id character varying(255),
    client_secret text,
    account_id character varying(255),
    access_token text,
    token_expires_at timestamp(6) with time zone,
    is_active boolean DEFAULT true NOT NULL,
    daily_view_limit integer DEFAULT 500 NOT NULL,
    views_used_today integer DEFAULT 0 NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tenant_domains; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.tenant_domains (
    id integer NOT NULL,
    tenant_id uuid NOT NULL,
    domain_name character varying(255) NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    verification_token character varying(255),
    verification_status character varying(50) DEFAULT 'VERIFIED'::character varying NOT NULL,
    ssl_status character varying(50) DEFAULT 'ACTIVE'::character varying NOT NULL,
    verified_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: tenant_domains_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.tenant_domains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_domains_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.tenant_domains_id_seq OWNED BY ats.tenant_domains.id;


--
-- Name: tenant_email_domains; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.tenant_email_domains (
    id integer NOT NULL,
    tenant_id uuid NOT NULL,
    email_domain character varying(255) NOT NULL,
    sender_address character varying(255) NOT NULL,
    dkim_tokens text[] DEFAULT ARRAY[]::text[],
    dkim_verified boolean DEFAULT false NOT NULL,
    spf_verified boolean DEFAULT false NOT NULL,
    status character varying(50) DEFAULT 'PENDING'::character varying NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    verified_at timestamp(6) with time zone
);


--
-- Name: tenant_email_domains_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.tenant_email_domains_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_email_domains_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.tenant_email_domains_id_seq OWNED BY ats.tenant_email_domains.id;


--
-- Name: tenant_stage_remarks; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.tenant_stage_remarks (
    id integer NOT NULL,
    tenant_id character varying(100) NOT NULL,
    stage character varying(50) NOT NULL,
    remark_text text NOT NULL,
    created_by character varying(100),
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    remark_type character varying(50) DEFAULT 'GENERAL'::character varying,
    branch_id character varying(255),
    is_global boolean DEFAULT true
);


--
-- Name: tenant_stage_remarks_id_seq; Type: SEQUENCE; Schema: ats; Owner: -
--

CREATE SEQUENCE ats.tenant_stage_remarks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_stage_remarks_id_seq; Type: SEQUENCE OWNED BY; Schema: ats; Owner: -
--

ALTER SEQUENCE ats.tenant_stage_remarks_id_seq OWNED BY ats.tenant_stage_remarks.id;


--
-- Name: tenants; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    logo_url text,
    site_title character varying(255),
    domain character varying(255),
    status character varying(50) DEFAULT 'ACTIVE'::character varying NOT NULL,
    default_market character varying(50) DEFAULT 'US'::character varying NOT NULL,
    user_limit integer DEFAULT 5 NOT NULL,
    prefix_code character varying(10),
    pod_system_enabled boolean DEFAULT true NOT NULL,
    max_branches integer DEFAULT 5 NOT NULL,
    candidate_pool_mode character varying(50) DEFAULT 'COMBINED_MARKET'::character varying NOT NULL,
    email_dispatch_mode character varying(50) DEFAULT 'DEFAULT_SUBDOMAIN'::character varying NOT NULL,
    custom_email_domain character varying(255),
    custom_email_domain_verified boolean DEFAULT false NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    job_assignment_options jsonb DEFAULT '{}'::jsonb,
    job_assignment_mode character varying(50) DEFAULT 'AUTO'::character varying,
    job_code_pattern character varying(200) DEFAULT '{BRANCH}-{UNIT}-{YYMMDD}-{SEQ}'::character varying,
    enforce_job_code_pattern boolean DEFAULT false NOT NULL
);


--
-- Name: user_invitations; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.user_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    full_name character varying(255),
    role_id uuid,
    branch_id uuid,
    pod_id uuid,
    invitation_token character varying(255) NOT NULL,
    token_expires_at timestamp(6) with time zone NOT NULL,
    created_by uuid,
    is_accepted boolean DEFAULT false NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    system_role_id uuid
);


--
-- Name: user_notification_settings; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.user_notification_settings (
    user_id uuid NOT NULL,
    sound_enabled boolean DEFAULT true NOT NULL,
    sound_preset character varying(50) DEFAULT 'CLASSIC_CHIME'::character varying NOT NULL,
    toast_enabled boolean DEFAULT true NOT NULL,
    job_alerts boolean DEFAULT true NOT NULL,
    review_alerts boolean DEFAULT true NOT NULL,
    submission_alerts boolean DEFAULT true NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: ats; Owner: -
--

CREATE TABLE ats.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    keycloak_id character varying(255),
    email character varying(255) NOT NULL,
    first_name character varying(128),
    last_name character varying(128),
    full_name character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_approved boolean DEFAULT true NOT NULL,
    profile_picture text,
    role_id uuid,
    assigned_role_ids uuid[] DEFAULT ARRAY[]::uuid[],
    branch_id uuid,
    assigned_branch_ids uuid[] DEFAULT ARRAY[]::uuid[],
    branch_roles jsonb DEFAULT '{}'::jsonb NOT NULL,
    business_unit_id uuid,
    job_reviewer_id uuid,
    pod_id uuid,
    last_login_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    requested_role character varying(128)
);


--
-- Name: campaigns; Type: TABLE; Schema: mass_mail; Owner: -
--

CREATE TABLE mass_mail.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    subject character varying(255),
    body_template text,
    status character varying(50) DEFAULT 'Draft'::character varying NOT NULL,
    created_by uuid,
    scheduled_at timestamp(6) with time zone,
    rate_per_minute integer DEFAULT 0 NOT NULL,
    rate_per_hour integer DEFAULT 0 NOT NULL,
    randomize_delay boolean DEFAULT false NOT NULL,
    email_account_id uuid,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: delivery_settings; Type: TABLE; Schema: mass_mail; Owner: -
--

CREATE TABLE mass_mail.delivery_settings (
    tenant_id uuid NOT NULL,
    branch_id character varying(255) DEFAULT 'default'::character varying NOT NULL,
    rate_per_minute integer DEFAULT 30 NOT NULL,
    rate_per_hour integer DEFAULT 500 NOT NULL,
    randomize_delay boolean DEFAULT false NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: email_accounts; Type: TABLE; Schema: mass_mail; Owner: -
--

CREATE TABLE mass_mail.email_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id character varying(255),
    tenant_id uuid,
    profile_name character varying(255),
    provider character varying(50) NOT NULL,
    email_address character varying(255) NOT NULL,
    access_token text,
    refresh_token text,
    password text,
    smtp_host character varying(255),
    smtp_port integer,
    imap_host character varying(255),
    imap_port integer,
    require_ssl boolean DEFAULT false NOT NULL,
    require_tls boolean DEFAULT false NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    shared_with_all boolean DEFAULT false NOT NULL,
    shared_with_branches uuid[] DEFAULT ARRAY[]::uuid[],
    shared_with_users uuid[] DEFAULT ARRAY[]::uuid[],
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: email_preferences; Type: TABLE; Schema: mass_mail; Owner: -
--

CREATE TABLE mass_mail.email_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    action_name character varying(255) NOT NULL,
    email_account_id uuid,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: recipients; Type: TABLE; Schema: mass_mail; Owner: -
--

CREATE TABLE mass_mail.recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    candidate_id uuid,
    email character varying(255) NOT NULL,
    first_name character varying(255),
    last_name character varying(255),
    status character varying(50) DEFAULT 'Pending'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    opened_at timestamp(6) with time zone,
    clicked_at timestamp(6) with time zone,
    sent_at timestamp(6) with time zone,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: templates; Type: TABLE; Schema: mass_mail; Owner: -
--

CREATE TABLE mass_mail.templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    subject character varying(255),
    body text,
    created_by uuid,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: candidate_education id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_education ALTER COLUMN id SET DEFAULT nextval('ats.candidate_education_id_seq'::regclass);


--
-- Name: candidate_experience id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_experience ALTER COLUMN id SET DEFAULT nextval('ats.candidate_experience_id_seq'::regclass);


--
-- Name: candidate_skills id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_skills ALTER COLUMN id SET DEFAULT nextval('ats.candidate_skills_id_seq'::regclass);


--
-- Name: companies_master id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.companies_master ALTER COLUMN id SET DEFAULT nextval('ats.companies_master_id_seq'::regclass);


--
-- Name: company_aliases id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.company_aliases ALTER COLUMN id SET DEFAULT nextval('ats.company_aliases_id_seq'::regclass);


--
-- Name: degree_aliases id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.degree_aliases ALTER COLUMN id SET DEFAULT nextval('ats.degree_aliases_id_seq'::regclass);


--
-- Name: degrees_master id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.degrees_master ALTER COLUMN id SET DEFAULT nextval('ats.degrees_master_id_seq'::regclass);


--
-- Name: designation_aliases id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.designation_aliases ALTER COLUMN id SET DEFAULT nextval('ats.designation_aliases_id_seq'::regclass);


--
-- Name: designations_master id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.designations_master ALTER COLUMN id SET DEFAULT nextval('ats.designations_master_id_seq'::regclass);


--
-- Name: location_aliases id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.location_aliases ALTER COLUMN id SET DEFAULT nextval('ats.location_aliases_id_seq'::regclass);


--
-- Name: locations_master id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.locations_master ALTER COLUMN id SET DEFAULT nextval('ats.locations_master_id_seq'::regclass);


--
-- Name: parser_candidates id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.parser_candidates ALTER COLUMN id SET DEFAULT nextval('ats.parser_candidates_id_seq'::regclass);


--
-- Name: pending_normalizations id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.pending_normalizations ALTER COLUMN id SET DEFAULT nextval('ats.pending_normalizations_id_seq'::regclass);


--
-- Name: skill_aliases id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.skill_aliases ALTER COLUMN id SET DEFAULT nextval('ats.skill_aliases_id_seq'::regclass);


--
-- Name: skill_categories id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.skill_categories ALTER COLUMN id SET DEFAULT nextval('ats.skill_categories_id_seq'::regclass);


--
-- Name: skills_master id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.skills_master ALTER COLUMN id SET DEFAULT nextval('ats.skills_master_id_seq'::regclass);


--
-- Name: tenant_domains id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_domains ALTER COLUMN id SET DEFAULT nextval('ats.tenant_domains_id_seq'::regclass);


--
-- Name: tenant_email_domains id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_email_domains ALTER COLUMN id SET DEFAULT nextval('ats.tenant_email_domains_id_seq'::regclass);


--
-- Name: tenant_stage_remarks id; Type: DEFAULT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_stage_remarks ALTER COLUMN id SET DEFAULT nextval('ats.tenant_stage_remarks_id_seq'::regclass);


--
-- Name: _BranchManagers _BranchManagers_AB_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats."_BranchManagers"
    ADD CONSTRAINT "_BranchManagers_AB_pkey" PRIMARY KEY ("A", "B");


--
-- Name: _BusinessUnitAdmins _BusinessUnitAdmins_AB_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats."_BusinessUnitAdmins"
    ADD CONSTRAINT "_BusinessUnitAdmins_AB_pkey" PRIMARY KEY ("A", "B");


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: bulk_upload_items bulk_upload_items_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.bulk_upload_items
    ADD CONSTRAINT bulk_upload_items_pkey PRIMARY KEY (id);


--
-- Name: bulk_uploads bulk_uploads_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.bulk_uploads
    ADD CONSTRAINT bulk_uploads_pkey PRIMARY KEY (id);


--
-- Name: business_units business_units_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.business_units
    ADD CONSTRAINT business_units_pkey PRIMARY KEY (id);


--
-- Name: candidate_education candidate_education_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_education
    ADD CONSTRAINT candidate_education_pkey PRIMARY KEY (id);


--
-- Name: candidate_experience candidate_experience_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_experience
    ADD CONSTRAINT candidate_experience_pkey PRIMARY KEY (id);


--
-- Name: candidate_skills candidate_skills_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_skills
    ADD CONSTRAINT candidate_skills_pkey PRIMARY KEY (id);


--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (id);


--
-- Name: client_contacts client_contacts_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.client_contacts
    ADD CONSTRAINT client_contacts_pkey PRIMARY KEY (id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: companies_master companies_master_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.companies_master
    ADD CONSTRAINT companies_master_pkey PRIMARY KEY (id);


--
-- Name: company_aliases company_aliases_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.company_aliases
    ADD CONSTRAINT company_aliases_pkey PRIMARY KEY (id);


--
-- Name: custom_roles custom_roles_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.custom_roles
    ADD CONSTRAINT custom_roles_pkey PRIMARY KEY (id);


--
-- Name: degree_aliases degree_aliases_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.degree_aliases
    ADD CONSTRAINT degree_aliases_pkey PRIMARY KEY (id);


--
-- Name: degrees_master degrees_master_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.degrees_master
    ADD CONSTRAINT degrees_master_pkey PRIMARY KEY (id);


--
-- Name: designation_aliases designation_aliases_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.designation_aliases
    ADD CONSTRAINT designation_aliases_pkey PRIMARY KEY (id);


--
-- Name: designations_master designations_master_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.designations_master
    ADD CONSTRAINT designations_master_pkey PRIMARY KEY (id);


--
-- Name: job_assignment_logs job_assignment_logs_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_assignment_logs
    ADD CONSTRAINT job_assignment_logs_pkey PRIMARY KEY (id);


--
-- Name: job_delegation_requests job_delegation_requests_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_delegation_requests
    ADD CONSTRAINT job_delegation_requests_pkey PRIMARY KEY (id);


--
-- Name: job_pods job_pods_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_pods
    ADD CONSTRAINT job_pods_pkey PRIMARY KEY (job_id, pod_id);


--
-- Name: job_recruiters job_recruiters_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_recruiters
    ADD CONSTRAINT job_recruiters_pkey PRIMARY KEY (job_id, recruiter_id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: kv_store kv_store_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.kv_store
    ADD CONSTRAINT kv_store_pkey PRIMARY KEY (key);


--
-- Name: location_aliases location_aliases_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.location_aliases
    ADD CONSTRAINT location_aliases_pkey PRIMARY KEY (id);


--
-- Name: locations_master locations_master_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.locations_master
    ADD CONSTRAINT locations_master_pkey PRIMARY KEY (id);


--
-- Name: market_segments market_segments_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.market_segments
    ADD CONSTRAINT market_segments_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: parser_candidates parser_candidates_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.parser_candidates
    ADD CONSTRAINT parser_candidates_pkey PRIMARY KEY (id);


--
-- Name: pending_normalizations pending_normalizations_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.pending_normalizations
    ADD CONSTRAINT pending_normalizations_pkey PRIMARY KEY (id);


--
-- Name: pods pods_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.pods
    ADD CONSTRAINT pods_pkey PRIMARY KEY (id);


--
-- Name: recruiter_submissions recruiter_submissions_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.recruiter_submissions
    ADD CONSTRAINT recruiter_submissions_pkey PRIMARY KEY (id);


--
-- Name: resumes resumes_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.resumes
    ADD CONSTRAINT resumes_pkey PRIMARY KEY (id);


--
-- Name: skill_aliases skill_aliases_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.skill_aliases
    ADD CONSTRAINT skill_aliases_pkey PRIMARY KEY (id);


--
-- Name: skill_categories skill_categories_name_key; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.skill_categories
    ADD CONSTRAINT skill_categories_name_key UNIQUE (name);


--
-- Name: skill_categories skill_categories_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.skill_categories
    ADD CONSTRAINT skill_categories_pkey PRIMARY KEY (id);


--
-- Name: skills_master skills_master_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.skills_master
    ADD CONSTRAINT skills_master_pkey PRIMARY KEY (id);


--
-- Name: system_roles system_roles_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.system_roles
    ADD CONSTRAINT system_roles_pkey PRIMARY KEY (id);


--
-- Name: tenant_auth_settings tenant_auth_settings_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_auth_settings
    ADD CONSTRAINT tenant_auth_settings_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant_counters tenant_counters_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_counters
    ADD CONSTRAINT tenant_counters_pkey PRIMARY KEY (tenant_id, entity_type);


--
-- Name: tenant_dice_integrations tenant_dice_integrations_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_dice_integrations
    ADD CONSTRAINT tenant_dice_integrations_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenant_domains tenant_domains_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_domains
    ADD CONSTRAINT tenant_domains_pkey PRIMARY KEY (id);


--
-- Name: tenant_email_domains tenant_email_domains_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_email_domains
    ADD CONSTRAINT tenant_email_domains_pkey PRIMARY KEY (id);


--
-- Name: tenant_stage_remarks tenant_stage_remarks_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_stage_remarks
    ADD CONSTRAINT tenant_stage_remarks_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: user_invitations user_invitations_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.user_invitations
    ADD CONSTRAINT user_invitations_pkey PRIMARY KEY (id);


--
-- Name: user_notification_settings user_notification_settings_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.user_notification_settings
    ADD CONSTRAINT user_notification_settings_pkey PRIMARY KEY (user_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: delivery_settings delivery_settings_pkey; Type: CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.delivery_settings
    ADD CONSTRAINT delivery_settings_pkey PRIMARY KEY (tenant_id, branch_id);


--
-- Name: email_accounts email_accounts_pkey; Type: CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.email_accounts
    ADD CONSTRAINT email_accounts_pkey PRIMARY KEY (id);


--
-- Name: email_preferences email_preferences_pkey; Type: CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.email_preferences
    ADD CONSTRAINT email_preferences_pkey PRIMARY KEY (id);


--
-- Name: recipients recipients_pkey; Type: CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.recipients
    ADD CONSTRAINT recipients_pkey PRIMARY KEY (id);


--
-- Name: templates templates_pkey; Type: CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);


--
-- Name: _BranchManagers_B_index; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX "_BranchManagers_B_index" ON ats."_BranchManagers" USING btree ("B");


--
-- Name: _BusinessUnitAdmins_B_index; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX "_BusinessUnitAdmins_B_index" ON ats."_BusinessUnitAdmins" USING btree ("B");


--
-- Name: branches_tenant_id_name_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX branches_tenant_id_name_key ON ats.branches USING btree (tenant_id, name);


--
-- Name: business_units_tenant_id_branch_id_idx; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX business_units_tenant_id_branch_id_idx ON ats.business_units USING btree (tenant_id, branch_id);


--
-- Name: business_units_tenant_id_branch_id_name_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX business_units_tenant_id_branch_id_name_key ON ats.business_units USING btree (tenant_id, branch_id, name);


--
-- Name: clients_tenant_id_client_code_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX clients_tenant_id_client_code_key ON ats.clients USING btree (tenant_id, client_code);


--
-- Name: idx_custom_roles_branch_name; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX idx_custom_roles_branch_name ON ats.custom_roles USING btree (tenant_id, branch_id, upper((name)::text)) WHERE ((is_system = false) AND (branch_id IS NOT NULL));


--
-- Name: idx_custom_roles_system_name; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX idx_custom_roles_system_name ON ats.custom_roles USING btree (tenant_id, upper((name)::text)) WHERE (is_system = true);


--
-- Name: idx_tenant_stage_remarks_tenant_branch; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX idx_tenant_stage_remarks_tenant_branch ON ats.tenant_stage_remarks USING btree (tenant_id, branch_id, stage);


--
-- Name: ix_candidate_education_candidate_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_candidate_education_candidate_id ON ats.candidate_education USING btree (candidate_id);


--
-- Name: ix_candidate_education_degree_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_candidate_education_degree_id ON ats.candidate_education USING btree (degree_id);


--
-- Name: ix_candidate_experience_candidate_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_candidate_experience_candidate_id ON ats.candidate_experience USING btree (candidate_id);


--
-- Name: ix_candidate_experience_company_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_candidate_experience_company_id ON ats.candidate_experience USING btree (company_id);


--
-- Name: ix_candidate_experience_designation_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_candidate_experience_designation_id ON ats.candidate_experience USING btree (designation_id);


--
-- Name: ix_candidate_skills_candidate_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_candidate_skills_candidate_id ON ats.candidate_skills USING btree (candidate_id);


--
-- Name: ix_candidate_skills_skill_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_candidate_skills_skill_id ON ats.candidate_skills USING btree (skill_id);


--
-- Name: ix_companies_master_canonical_company_name; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX ix_companies_master_canonical_company_name ON ats.companies_master USING btree (canonical_company_name);


--
-- Name: ix_company_aliases_alias; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX ix_company_aliases_alias ON ats.company_aliases USING btree (alias);


--
-- Name: ix_company_aliases_company_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_company_aliases_company_id ON ats.company_aliases USING btree (company_id);


--
-- Name: ix_degree_aliases_alias; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX ix_degree_aliases_alias ON ats.degree_aliases USING btree (alias);


--
-- Name: ix_degree_aliases_degree_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_degree_aliases_degree_id ON ats.degree_aliases USING btree (degree_id);


--
-- Name: ix_degrees_master_canonical_degree; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX ix_degrees_master_canonical_degree ON ats.degrees_master USING btree (canonical_degree);


--
-- Name: ix_designation_aliases_alias; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX ix_designation_aliases_alias ON ats.designation_aliases USING btree (alias);


--
-- Name: ix_designation_aliases_designation_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_designation_aliases_designation_id ON ats.designation_aliases USING btree (designation_id);


--
-- Name: ix_designations_master_canonical_designation; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX ix_designations_master_canonical_designation ON ats.designations_master USING btree (canonical_designation);


--
-- Name: ix_location_aliases_alias; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX ix_location_aliases_alias ON ats.location_aliases USING btree (alias);


--
-- Name: ix_location_aliases_location_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_location_aliases_location_id ON ats.location_aliases USING btree (location_id);


--
-- Name: ix_locations_master_canonical_location; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX ix_locations_master_canonical_location ON ats.locations_master USING btree (canonical_location);


--
-- Name: ix_parser_candidates_current_designation_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_parser_candidates_current_designation_id ON ats.parser_candidates USING btree (current_designation_id);


--
-- Name: ix_parser_candidates_current_location_id; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_parser_candidates_current_location_id ON ats.parser_candidates USING btree (current_location_id);


--
-- Name: ix_parser_candidates_email; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_parser_candidates_email ON ats.parser_candidates USING btree (email);


--
-- Name: ix_parser_candidates_full_name; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_parser_candidates_full_name ON ats.parser_candidates USING btree (full_name);


--
-- Name: ix_parser_candidates_phone; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX ix_parser_candidates_phone ON ats.parser_candidates USING btree (phone);


--
-- Name: jobs_job_code_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX jobs_job_code_key ON ats.jobs USING btree (job_code);


--
-- Name: market_segments_tenant_id_code_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX market_segments_tenant_id_code_key ON ats.market_segments USING btree (tenant_id, code);


--
-- Name: market_segments_tenant_id_idx; Type: INDEX; Schema: ats; Owner: -
--

CREATE INDEX market_segments_tenant_id_idx ON ats.market_segments USING btree (tenant_id);


--
-- Name: market_segments_tenant_id_name_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX market_segments_tenant_id_name_key ON ats.market_segments USING btree (tenant_id, name);


--
-- Name: pending_normalizations_raw_value_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX pending_normalizations_raw_value_key ON ats.pending_normalizations USING btree (raw_value);


--
-- Name: system_roles_name_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX system_roles_name_key ON ats.system_roles USING btree (name);


--
-- Name: system_roles_system_key_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX system_roles_system_key_key ON ats.system_roles USING btree (system_key);


--
-- Name: tenant_domains_domain_name_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX tenant_domains_domain_name_key ON ats.tenant_domains USING btree (domain_name);


--
-- Name: tenant_email_domains_email_domain_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX tenant_email_domains_email_domain_key ON ats.tenant_email_domains USING btree (email_domain);


--
-- Name: tenants_domain_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX tenants_domain_key ON ats.tenants USING btree (domain);


--
-- Name: tenants_prefix_code_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX tenants_prefix_code_key ON ats.tenants USING btree (prefix_code);


--
-- Name: user_invitations_invitation_token_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX user_invitations_invitation_token_key ON ats.user_invitations USING btree (invitation_token);


--
-- Name: user_invitations_tenant_id_email_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX user_invitations_tenant_id_email_key ON ats.user_invitations USING btree (tenant_id, email);


--
-- Name: users_tenant_id_email_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX users_tenant_id_email_key ON ats.users USING btree (tenant_id, email);


--
-- Name: users_tenant_id_keycloak_id_key; Type: INDEX; Schema: ats; Owner: -
--

CREATE UNIQUE INDEX users_tenant_id_keycloak_id_key ON ats.users USING btree (tenant_id, keycloak_id);


--
-- Name: email_accounts_provider_email_address_tenant_id_key; Type: INDEX; Schema: mass_mail; Owner: -
--

CREATE UNIQUE INDEX email_accounts_provider_email_address_tenant_id_key ON mass_mail.email_accounts USING btree (provider, email_address, tenant_id);


--
-- Name: email_preferences_action_name_key; Type: INDEX; Schema: mass_mail; Owner: -
--

CREATE UNIQUE INDEX email_preferences_action_name_key ON mass_mail.email_preferences USING btree (action_name);


--
-- Name: _BranchManagers _BranchManagers_A_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats."_BranchManagers"
    ADD CONSTRAINT "_BranchManagers_A_fkey" FOREIGN KEY ("A") REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _BranchManagers _BranchManagers_B_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats."_BranchManagers"
    ADD CONSTRAINT "_BranchManagers_B_fkey" FOREIGN KEY ("B") REFERENCES ats.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _BusinessUnitAdmins _BusinessUnitAdmins_A_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats."_BusinessUnitAdmins"
    ADD CONSTRAINT "_BusinessUnitAdmins_A_fkey" FOREIGN KEY ("A") REFERENCES ats.business_units(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _BusinessUnitAdmins _BusinessUnitAdmins_B_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats."_BusinessUnitAdmins"
    ADD CONSTRAINT "_BusinessUnitAdmins_B_fkey" FOREIGN KEY ("B") REFERENCES ats.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: branches branches_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.branches
    ADD CONSTRAINT branches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bulk_upload_items bulk_upload_items_bulk_upload_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.bulk_upload_items
    ADD CONSTRAINT bulk_upload_items_bulk_upload_id_fkey FOREIGN KEY (bulk_upload_id) REFERENCES ats.bulk_uploads(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bulk_upload_items bulk_upload_items_candidate_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.bulk_upload_items
    ADD CONSTRAINT bulk_upload_items_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES ats.candidates(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: bulk_uploads bulk_uploads_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.bulk_uploads
    ADD CONSTRAINT bulk_uploads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: business_units business_units_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.business_units
    ADD CONSTRAINT business_units_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: business_units business_units_market_segment_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.business_units
    ADD CONSTRAINT business_units_market_segment_id_fkey FOREIGN KEY (market_segment_id) REFERENCES ats.market_segments(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: business_units business_units_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.business_units
    ADD CONSTRAINT business_units_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: candidate_education candidate_education_candidate_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_education
    ADD CONSTRAINT candidate_education_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES ats.parser_candidates(id);


--
-- Name: candidate_education candidate_education_degree_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_education
    ADD CONSTRAINT candidate_education_degree_id_fkey FOREIGN KEY (degree_id) REFERENCES ats.degrees_master(id);


--
-- Name: candidate_experience candidate_experience_candidate_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_experience
    ADD CONSTRAINT candidate_experience_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES ats.parser_candidates(id);


--
-- Name: candidate_experience candidate_experience_company_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_experience
    ADD CONSTRAINT candidate_experience_company_id_fkey FOREIGN KEY (company_id) REFERENCES ats.companies_master(id);


--
-- Name: candidate_experience candidate_experience_designation_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_experience
    ADD CONSTRAINT candidate_experience_designation_id_fkey FOREIGN KEY (designation_id) REFERENCES ats.designations_master(id);


--
-- Name: candidate_skills candidate_skills_candidate_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_skills
    ADD CONSTRAINT candidate_skills_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES ats.parser_candidates(id);


--
-- Name: candidate_skills candidate_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidate_skills
    ADD CONSTRAINT candidate_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES ats.skills_master(id);


--
-- Name: candidates candidates_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidates
    ADD CONSTRAINT candidates_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: candidates candidates_resume_record_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidates
    ADD CONSTRAINT candidates_resume_record_id_fkey FOREIGN KEY (resume_record_id) REFERENCES ats.resumes(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: candidates candidates_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.candidates
    ADD CONSTRAINT candidates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_contacts client_contacts_client_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.client_contacts
    ADD CONSTRAINT client_contacts_client_id_fkey FOREIGN KEY (client_id) REFERENCES ats.clients(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: client_contacts client_contacts_created_by_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.client_contacts
    ADD CONSTRAINT client_contacts_created_by_fkey FOREIGN KEY (created_by) REFERENCES ats.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: client_contacts client_contacts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.client_contacts
    ADD CONSTRAINT client_contacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: clients clients_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.clients
    ADD CONSTRAINT clients_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: clients clients_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.clients
    ADD CONSTRAINT clients_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: company_aliases company_aliases_company_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.company_aliases
    ADD CONSTRAINT company_aliases_company_id_fkey FOREIGN KEY (company_id) REFERENCES ats.companies_master(id);


--
-- Name: custom_roles custom_roles_base_role_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.custom_roles
    ADD CONSTRAINT custom_roles_base_role_id_fkey FOREIGN KEY (base_role_id) REFERENCES ats.custom_roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: custom_roles custom_roles_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.custom_roles
    ADD CONSTRAINT custom_roles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: custom_roles custom_roles_business_unit_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.custom_roles
    ADD CONSTRAINT custom_roles_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES ats.business_units(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: custom_roles custom_roles_system_role_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.custom_roles
    ADD CONSTRAINT custom_roles_system_role_id_fkey FOREIGN KEY (system_role_id) REFERENCES ats.system_roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: custom_roles custom_roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.custom_roles
    ADD CONSTRAINT custom_roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: degree_aliases degree_aliases_degree_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.degree_aliases
    ADD CONSTRAINT degree_aliases_degree_id_fkey FOREIGN KEY (degree_id) REFERENCES ats.degrees_master(id);


--
-- Name: designation_aliases designation_aliases_designation_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.designation_aliases
    ADD CONSTRAINT designation_aliases_designation_id_fkey FOREIGN KEY (designation_id) REFERENCES ats.designations_master(id);


--
-- Name: job_assignment_logs job_assignment_logs_job_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_assignment_logs
    ADD CONSTRAINT job_assignment_logs_job_id_fkey FOREIGN KEY (job_id) REFERENCES ats.jobs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_assignment_logs job_assignment_logs_pod_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_assignment_logs
    ADD CONSTRAINT job_assignment_logs_pod_id_fkey FOREIGN KEY (pod_id) REFERENCES ats.pods(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: job_assignment_logs job_assignment_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_assignment_logs
    ADD CONSTRAINT job_assignment_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_delegation_requests job_delegation_requests_assigned_pod_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_delegation_requests
    ADD CONSTRAINT job_delegation_requests_assigned_pod_id_fkey FOREIGN KEY (assigned_pod_id) REFERENCES ats.pods(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: job_delegation_requests job_delegation_requests_job_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_delegation_requests
    ADD CONSTRAINT job_delegation_requests_job_id_fkey FOREIGN KEY (job_id) REFERENCES ats.jobs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_delegation_requests job_delegation_requests_source_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_delegation_requests
    ADD CONSTRAINT job_delegation_requests_source_branch_id_fkey FOREIGN KEY (source_branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_delegation_requests job_delegation_requests_source_unit_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_delegation_requests
    ADD CONSTRAINT job_delegation_requests_source_unit_id_fkey FOREIGN KEY (source_unit_id) REFERENCES ats.business_units(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: job_delegation_requests job_delegation_requests_target_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_delegation_requests
    ADD CONSTRAINT job_delegation_requests_target_branch_id_fkey FOREIGN KEY (target_branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_delegation_requests job_delegation_requests_target_unit_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_delegation_requests
    ADD CONSTRAINT job_delegation_requests_target_unit_id_fkey FOREIGN KEY (target_unit_id) REFERENCES ats.business_units(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: job_delegation_requests job_delegation_requests_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_delegation_requests
    ADD CONSTRAINT job_delegation_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_pods job_pods_job_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_pods
    ADD CONSTRAINT job_pods_job_id_fkey FOREIGN KEY (job_id) REFERENCES ats.jobs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_pods job_pods_pod_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_pods
    ADD CONSTRAINT job_pods_pod_id_fkey FOREIGN KEY (pod_id) REFERENCES ats.pods(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_recruiters job_recruiters_job_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_recruiters
    ADD CONSTRAINT job_recruiters_job_id_fkey FOREIGN KEY (job_id) REFERENCES ats.jobs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: job_recruiters job_recruiters_recruiter_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.job_recruiters
    ADD CONSTRAINT job_recruiters_recruiter_id_fkey FOREIGN KEY (recruiter_id) REFERENCES ats.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: jobs jobs_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.jobs
    ADD CONSTRAINT jobs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: jobs jobs_client_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.jobs
    ADD CONSTRAINT jobs_client_id_fkey FOREIGN KEY (client_id) REFERENCES ats.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: jobs jobs_end_client_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.jobs
    ADD CONSTRAINT jobs_end_client_id_fkey FOREIGN KEY (end_client_id) REFERENCES ats.clients(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: jobs jobs_end_client_poc_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.jobs
    ADD CONSTRAINT jobs_end_client_poc_id_fkey FOREIGN KEY (end_client_poc_id) REFERENCES ats.client_contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: jobs jobs_poc_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.jobs
    ADD CONSTRAINT jobs_poc_id_fkey FOREIGN KEY (poc_id) REFERENCES ats.client_contacts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: jobs jobs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.jobs
    ADD CONSTRAINT jobs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: location_aliases location_aliases_location_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.location_aliases
    ADD CONSTRAINT location_aliases_location_id_fkey FOREIGN KEY (location_id) REFERENCES ats.locations_master(id);


--
-- Name: market_segments market_segments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.market_segments
    ADD CONSTRAINT market_segments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.notifications
    ADD CONSTRAINT notifications_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES ats.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: parser_candidates parser_candidates_current_designation_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.parser_candidates
    ADD CONSTRAINT parser_candidates_current_designation_id_fkey FOREIGN KEY (current_designation_id) REFERENCES ats.designations_master(id);


--
-- Name: parser_candidates parser_candidates_current_location_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.parser_candidates
    ADD CONSTRAINT parser_candidates_current_location_id_fkey FOREIGN KEY (current_location_id) REFERENCES ats.locations_master(id);


--
-- Name: parser_candidates parser_candidates_resume_record_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.parser_candidates
    ADD CONSTRAINT parser_candidates_resume_record_id_fkey FOREIGN KEY (resume_record_id) REFERENCES ats.resumes(id);


--
-- Name: pods pods_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.pods
    ADD CONSTRAINT pods_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: pods pods_business_unit_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.pods
    ADD CONSTRAINT pods_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES ats.business_units(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: pods pods_pod_head_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.pods
    ADD CONSTRAINT pods_pod_head_id_fkey FOREIGN KEY (pod_head_id) REFERENCES ats.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: pods pods_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.pods
    ADD CONSTRAINT pods_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: recruiter_submissions recruiter_submissions_candidate_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.recruiter_submissions
    ADD CONSTRAINT recruiter_submissions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES ats.candidates(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: recruiter_submissions recruiter_submissions_job_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.recruiter_submissions
    ADD CONSTRAINT recruiter_submissions_job_id_fkey FOREIGN KEY (job_id) REFERENCES ats.jobs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: recruiter_submissions recruiter_submissions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.recruiter_submissions
    ADD CONSTRAINT recruiter_submissions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: skill_aliases skill_aliases_skill_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.skill_aliases
    ADD CONSTRAINT skill_aliases_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES ats.skills_master(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tenant_auth_settings tenant_auth_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_auth_settings
    ADD CONSTRAINT tenant_auth_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tenant_counters tenant_counters_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_counters
    ADD CONSTRAINT tenant_counters_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tenant_dice_integrations tenant_dice_integrations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_dice_integrations
    ADD CONSTRAINT tenant_dice_integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tenant_domains tenant_domains_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_domains
    ADD CONSTRAINT tenant_domains_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: tenant_email_domains tenant_email_domains_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.tenant_email_domains
    ADD CONSTRAINT tenant_email_domains_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_invitations user_invitations_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.user_invitations
    ADD CONSTRAINT user_invitations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_invitations user_invitations_pod_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.user_invitations
    ADD CONSTRAINT user_invitations_pod_id_fkey FOREIGN KEY (pod_id) REFERENCES ats.pods(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_invitations user_invitations_role_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.user_invitations
    ADD CONSTRAINT user_invitations_role_id_fkey FOREIGN KEY (role_id) REFERENCES ats.custom_roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_invitations user_invitations_system_role_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.user_invitations
    ADD CONSTRAINT user_invitations_system_role_id_fkey FOREIGN KEY (system_role_id) REFERENCES ats.system_roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_invitations user_invitations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.user_invitations
    ADD CONSTRAINT user_invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_notification_settings user_notification_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.user_notification_settings
    ADD CONSTRAINT user_notification_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES ats.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: users users_branch_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.users
    ADD CONSTRAINT users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES ats.branches(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: users users_business_unit_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.users
    ADD CONSTRAINT users_business_unit_id_fkey FOREIGN KEY (business_unit_id) REFERENCES ats.business_units(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: users users_job_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.users
    ADD CONSTRAINT users_job_reviewer_id_fkey FOREIGN KEY (job_reviewer_id) REFERENCES ats.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: users users_pod_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.users
    ADD CONSTRAINT users_pod_id_fkey FOREIGN KEY (pod_id) REFERENCES ats.pods(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES ats.custom_roles(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: ats; Owner: -
--

ALTER TABLE ONLY ats.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES ats.tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: campaigns campaigns_email_account_id_fkey; Type: FK CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.campaigns
    ADD CONSTRAINT campaigns_email_account_id_fkey FOREIGN KEY (email_account_id) REFERENCES mass_mail.email_accounts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: email_preferences email_preferences_email_account_id_fkey; Type: FK CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.email_preferences
    ADD CONSTRAINT email_preferences_email_account_id_fkey FOREIGN KEY (email_account_id) REFERENCES mass_mail.email_accounts(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: recipients recipients_campaign_id_fkey; Type: FK CONSTRAINT; Schema: mass_mail; Owner: -
--

ALTER TABLE ONLY mass_mail.recipients
    ADD CONSTRAINT recipients_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES mass_mail.campaigns(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
COMMIT;
