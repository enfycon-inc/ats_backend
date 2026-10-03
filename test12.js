
// @ts-nocheck


 | null;
  recruiters?: {
    names;
    ids?;
    count;
    label;
  } | null;
}

function getAssignedPersonDisplay(job) {
  const rawAssigned = ((job).assignedTo || 'N/A' || "").trim();
  const rawUpper = rawAssigned.toUpperCase();

  // 1. Check if assigned to ALL branch recruiters
  if (rawUpper === "ALL" || rawUpper.startsWith("ALL ") || rawUpper === "ALL RECRUITERS") {
    return { label: "All recruiters", type: "all", count: 0, isUnassigned };
  }

  // 2. Extract Pods info
  let podsInfo: { names; count; label } | null = null;
  const isPodAssigned =
    (job.podName && job.podName !== "N/A" && job.podName.toLowerCase() !== "unassigned") ||
    (job.podId && job.podId !== "none" && job.podId !== "off");

  if (isPodAssigned) {
    const podStr =
      (job.podName && job.podName !== "N/A" && job.podName.toLowerCase() !== "unassigned"
        ? job.podName
        : "") || "";
    if (podStr) {
      const names = podStr.split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length > 0) {
        podsInfo = {
          names,
          ids: (job.podId && job.podId !== "none" && job.podId !== "off") ? String(job.podId).split(",").map(id => id.trim()) ,
          count.length,
          label.length > 1 ? `${names[0]} +${names.length - 1}` 0],
        };
      }
    } else if (job.podId && job.podId !== "none") {
      podsInfo = {
        names"Recruitment Pod"],
        count: 1,
        label: "Recruitment Pod",
      };
    }
  }

  // 3. Extract Recruiters info
  let recruitersInfo: { names; ids?; count; label } | null = null;
  const podNamesLower = podsInfo ? podsInfo.names.map((n) => n.toLowerCase()) ;

  if (rawAssigned && rawUpper !== "N/A" && rawUpper !== "UNASSIGNED" && rawUpper !== "NONE") {
    const assignedTokens = rawAssigned.split(",").map((s) => s.trim()).filter(Boolean);
    const nonPodRecruiterNames = assignedTokens.filter(
      (t) => !podNamesLower.includes(t.toLowerCase())
    );

    if (nonPodRecruiterNames.length > 0) {
      recruitersInfo = {
        names,
          ids: (job).recruiterIds || [],
        count.length,
        label:
          nonPodRecruiterNames.length > 1
            ? `${nonPodRecruiterNames[0]} +${nonPodRecruiterNames.length - 1}`
            0],
      };
    }
  }

  if (
    !recruitersInfo &&
    job.recruiter &&
    job.recruiter !== "N/A" &&
    job.recruiter.toLowerCase() !== "unassigned"
  ) {
    const recruiterNames = job.recruiter.split(",").map((s) => s.trim()).filter(Boolean);
    const nonPodNames = recruiterNames.filter((t) => !podNamesLower.includes(t.toLowerCase()));

    if (nonPodNames.length > 0) {
      recruitersInfo = {
        names,
        ids: (job).recruiterIds || [],
        count.length,
        label.length > 1 ? `${nonPodNames[0]} +${nonPodNames.length - 1}` 0],
      };
    }
  }

  // Combine outcomes:
  if (podsInfo && recruitersInfo) {
    return {
      label: `${podsInfo.label} • ${recruitersInfo.label}`,
      type: "both",
      pods,
      recruiters,
      count.count + recruitersInfo.count,
      isUnassigned,
    };
  }

  if (podsInfo) {
    return {
      label.label,
      type: "pod",
      names.names,
      count.count,
      pods,
      isUnassigned,
    };
  }

  if (recruitersInfo) {
    return {
      label.label,
      type: "recruiter",
      names.names,
      count.count,
      recruiters,
      isUnassigned,
    };
  }

  return { label: "Unassigned", type: "unassigned", count: 0, isUnassigned };
}

function isJobPostedToday(job) {
  if (!job) return false;

  // 1. Check createdOn or createdAt date string
  const dateStr = (job).createdAt || job.createdOn;
  if (dateStr) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const today = new Date();
        const isSameDay =
          d.getDate() === today.getDate() &&
          d.getMonth() === today.getMonth() &&
          d.getFullYear() === today.getFullYear();
        if (isSameDay) return true;
      }
    } catch {}
  }

  // 2. Check if job code date segment matches today's date (e.g. BBS-260903-D00001)
  if (job.jobCode) {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const todaySegment = `${yy}${mm}${dd}`;
    if (job.jobCode.includes(`-${todaySegment}-`)) {
      return true;
    }
  }

  return false;
}

function isJobRecent(job) {
  if (!job) return false;

  // Must be Active
  const status = String(job.jobStatus || (job).status || "").toLowerCase();
  if (status !== "active") return false;

  // 1. Check agingDays if available (must be <= 1 day)
  if (typeof job.agingDays === "number" && !isNaN(job.agingDays)) {
    if (job.agingDays <= 1) return true;
    if (job.agingDays > 1) return false;
  }

  // 2. Check createdOn or createdAt date string (within 1 day / 24 hours)
  const dateStr = (job).createdAt || job.createdOn;
  if (dateStr) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const diffHours = (Date.now() - d.getTime()) / (1000 * 60 * 60);
        if (diffHours >= 0 && diffHours <= 24) return true;

        // Also check if created yesterday / today within 36h timezone buffer
        const now = new Date();
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
        if (d.getTime() >= startOfYesterday && diffHours <= 36) return true;

        return false;
      }
    } catch {}
  }

  // 3. Fallback jobCode date segment if matches (e.g. BBS-260910-D00003)
  if (job.jobCode) {
    const match = job.jobCode.match(/-(\d{2})(\d{2})(\d{2})-/);
    if (match) {
      try {
        const yy = parseInt("20" + match[1], 10);
        const mm = parseInt(match[2], 10) - 1;
        const dd = parseInt(match[3], 10);
        const jobDate = new Date(yy, mm, dd);
        if (!isNaN(jobDate.getTime())) {
          const diffDays = (Date.now() - jobDate.getTime()) / (1000 * 60 * 60 * 24);
          if (diffDays <= 1) return true;
          return false;
        }
      } catch {}
    }
  }

  return isJobPostedToday(job);
}

function formatDateTimeDisplay(
  dateStr? | null,
  job?
): { date; time } {
  if (!dateStr) return { date: "—", time: "" };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      return { date(dateStr), time: "" };
    }

    // Determine target timezone snapshot timezone -> market timezone -> local fallback
    let timeZone | undefined = undefined;
    if (job?.jobTimezone) {
      timeZone = job.jobTimezone;
    } else if (job?.market === "US") {
      timeZone = "America/New_York";
    } else if (job?.market === "IN") {
      timeZone = "Asia/Kolkata";
    }

    const dateFormatted = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone,
    });

    const timeFormatted = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12,
      timeZoneName: "short",
      timeZone,
    });

    return { date, time };
  } catch {
    return { date(dateStr), time: "" };
  }
}

function exportJobsToCSV(
  jobs,
  selectedColumns,
  allColumns: { id; label }[]
) {
  const headers = selectedColumns.map(
    (colId) => allColumns.find((c) => c.id === colId)?.label || colId
  );
  const rows = jobs.map((job) =>
    selectedColumns.map((colId) => {
      const value = job[colId as keyof Job];
      if (typeof value === "object") {
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
      }
      return `"${String(value || "").replace(/"/g, '""')}"`;
    })
  );

  const csvContent =
    "data:text/csv;charset=utf-8,\uFEFF" +
    [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `jobs_export_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}


const job = {
  id: '639aaf25-6a6d-4107-9c54-582456d03296',
  recruiterId: '38714d0b-8262-493d-82f1-9df34eb54ab8',
  recruiter: 'Ananya Reddy, Recruiter One, Recruiter Two',
  recruiterIds: [
    '990dfd65-a084-47bd-89db-0845dff5c14f',
    '19536aad-971c-411c-adb4-b2ebcb908db9',
    'aea9b4c4-f600-44a7-b136-7b4574421ffd'
  ]
};

console.log(JSON.stringify(getAssignedPersonDisplay(job), null, 2));
