import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tenantId = 'd3b07384-d113-49c3-a555-9ee75c13ca33'; // from .env DEFAULT_TENANT_ID

  const payload = {
    client_name: "Test Audit Client",
    email_id: "test@enfycon.com",
    status: "Active",
    country: "India",
    city: "Bhubneswar",
    ownership: "Rajesh Gupta",
    about_company: null,
    commission_percentage: 8.33,
    msa_signed: true,
    sow_executed: true,
    payment_terms: "Immediate"
  };
  
  const dto = payload as any;
  const initialStatus = 'Active';

  try {
    const created = await prisma.client.create({
      data: {
        tenantId,
        clientCode: 'TST-0001',
        clientName: dto.client_name,
        contactNumber: dto.contact_number,
        website: dto.website,
        industry: dto.industry,
        state: dto.state,
        city: dto.city,
        status: dto.status || initialStatus,
        category: dto.category,
        primaryOwner: 'System',
        businessUnit: dto.business_unit || 'Default',
        ownership: dto.ownership,
        displayOnJobPosting: dto.display_on_job_posting !== undefined ? dto.display_on_job_posting : true,
        createdBy: null,
        federalId: dto.federal_id,
        emailId: dto.email_id,
        fax: dto.fax,
        paymentTerms: dto.payment_terms || 'Net 30',
        address: dto.address,
        clientLead: dto.client_lead || dto.contact_person,
        postalCode: dto.postal_code,
        country: dto.country,
        practice: dto.practice,
        requiredDocuments: dto.required_documents,
        tag: dto.tag,
        clientShortName: dto.client_short_name,
        geopoliticalZone: dto.geopolitical_zone,
        primaryBusinessUnit: dto.primary_business_unit,
        facilityManagement: dto.facility_management,
        modifiedBy: 'System',
        aboutCompany: dto.about_company,
        stopNotifications: dto.stop_notifications || false,
        market: dto.market || 'US',
        endClientName: dto.client_name,
        isSameAsPrimary: dto.is_same_as_primary !== undefined ? dto.is_same_as_primary : true,
        contactPerson: dto.contact_person || dto.contact_name,
        contactDesignation: dto.contact_designation,
        gstin: dto.gstin,
        panNumber: dto.pan_number,
        currency: dto.currency || (dto.market === 'INDIA' ? 'INR' : 'USD'),
        tierRating: dto.tier_rating || 'TIER_1',
        creditCheckStatus: dto.credit_check_status || 'APPROVED',
        fillabilityScore: dto.fillability_score || 'HIGH',
        vettingNotes: dto.vetting_notes,
        onboardingStatus: dto.onboarding_status || 'ACTIVE',
        msaSigned: dto.msa_signed || false,
        sowExecuted: dto.sow_executed || false,
      },
    });
    console.log("Success:", created.id);
  } catch (e: any) {
    console.log("Prisma Error:");
    console.log(e.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
