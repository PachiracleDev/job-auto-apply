import type { Portal } from "@/types/index.js";

const linkedinSelectors = {
  jobCard: ".jobs-search-results__list-item, .scaffold-layout__list-item",
  jobTitleLink: "a.job-card-list__title-link, a.job-card-container__link",
  companyName: ".job-card-container__primary-description, .artdeco-entity-lockup__subtitle",
  jobLocation: ".job-card-container__metadata-item",
  jobDescription: ".jobs-description__content, .jobs-box__html-content",
  easyApplyButton: "button.jobs-apply-button--top-card, button[aria-label*='Easy Apply']",
  modalRoot: ".jobs-easy-apply-modal, [data-test-modal-id]",
  formField: "input, textarea, select",
  submitButton: "button[aria-label='Submit application'], button.jobs-apply-button",
  nextButton: "button[aria-label='Continue to next step']",
  dismissButton: "button[aria-label='Dismiss'], button.artdeco-modal__dismiss",
} as const;

export const linkedinPortal: Portal = {
  name: "linkedin",
  baseUrl: "https://www.linkedin.com",
  searchUrl: (query: string, location: string) => {
    const params = new URLSearchParams({
      keywords: query,
      location: location,
      f_TPR: "r86400",
      position: "1",
      pageNum: "0",
    });
    return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
  },
  selectors: linkedinSelectors as unknown as Record<string, string>,
};
