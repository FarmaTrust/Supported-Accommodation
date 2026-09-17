import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import DashboardLayout from "./components/DashboardLayout";
import { lazy, Suspense } from "react";

const Home = lazy(() => import("./pages/Home"));
const PropertiesPage = lazy(() => import("./pages/Properties"));
const WorkforcePage = lazy(() => import("./pages/Workforce"));
const PlacementsPage = lazy(() => import("./pages/Placements"));
const RotaPage = lazy(() => import("./pages/Rota"));
const CompliancePage = lazy(() => import("./pages/Compliance"));
const WorkPlansPage = lazy(() => import("./pages/WorkPlans"));
const FinancePage = lazy(() => import("./pages/Finance"));
const InvoiceDetailPage = lazy(() => import("./pages/InvoiceDetail"));
const DocumentsPage = lazy(() => import("./pages/Documents"));
const SearchPage = lazy(() => import("./pages/Search"));
const SharePackPage = lazy(() => import("./pages/SharePack"));
const InvoiceSharePage = lazy(() => import("./pages/InvoiceShare"));
const AssurancePage = lazy(() => import("./pages/Assurance"));
const QualityReviewsPage = lazy(() => import("./pages/QualityReviews"));
const Regulation28Page = lazy(() => import("./pages/Regulation28"));
const CareOperationsPage = lazy(() => import("./pages/CareOperations"));
const SafeguardingPage = lazy(() => import("./pages/Safeguarding"));
const RotaControlsPage = lazy(() => import("./pages/RotaControls"));
const ComplianceDashboardPage = lazy(() => import("./pages/ComplianceDashboard"));
const GovernanceHubPage = lazy(() => import("./pages/GovernanceHub"));
const StaffWorkspacePage = lazy(() => import("./pages/StaffWorkspace"));
const ManagerAppPage = lazy(() => import("./pages/ManagerApp"));
const KeyWorkerAppPage = lazy(() => import("./pages/KeyWorkerApp"));
const KeyWorkerPage = lazy(() => import("./pages/KeyWorker"));
const AccessControlPage = lazy(() => import("./pages/AccessControl"));
const RoleManagementPage = lazy(() => import("./pages/RoleManagement"));
const GuestInvitationPage = lazy(() => import("./pages/GuestInvitation"));
const TemporaryLoginLinkPage = lazy(() => import("./pages/TemporaryLoginLink"));
const SuperadminPage = lazy(() => import("./pages/Superadmin"));
const NominatedIndividualAppPage = lazy(() => import("./pages/NominatedIndividualApp"));

function Router() {
  return (
    <Suspense fallback={<div className="surface m-6 h-56 animate-pulse" aria-label="Loading page" />}>
      <Switch>
        <Route path={"/share/:token"} component={SharePackPage} />
        <Route path={"/invoice-share/:token"} component={InvoiceSharePage} />
        <Route path={"/guest/:token"} component={GuestInvitationPage} />
        <Route path={"/access/temporary/:token"} component={TemporaryLoginLinkPage} />
        <Route>
          <DashboardLayout>
            <Switch>
          <Route path={"/"} component={Home} />
          <Route path={"/properties"} component={PropertiesPage} />
          <Route path={"/workforce"} component={WorkforcePage} />
          <Route path={"/staff"} component={StaffWorkspacePage} />
          <Route path={"/staff-app"} component={StaffWorkspacePage} />
          <Route path={"/manager-app"} component={ManagerAppPage} />
          <Route path={"/nominated-individual"} component={NominatedIndividualAppPage} />
          <Route path={"/keyworker-app"} component={KeyWorkerAppPage} />
          <Route path={"/access-control"} component={AccessControlPage} />
          <Route path={"/role-management"} component={RoleManagementPage} />
          <Route path={"/superadmin"} component={SuperadminPage} />
          <Route path={"/placements"} component={PlacementsPage} />
          <Route path={"/rota"} component={RotaPage} />
          <Route path={"/compliance"} component={CompliancePage} />
          <Route path={"/compliance-dashboard"} component={ComplianceDashboardPage} />
          <Route path={"/governance"} component={GovernanceHubPage} />
          <Route path={"/work-plans"} component={WorkPlansPage} />
          <Route path={"/finance"} component={FinancePage} />
          <Route path={"/finance/invoice/:id"} component={InvoiceDetailPage} />
          <Route path={"/documents"} component={DocumentsPage} />
          <Route path={"/key-worker"} component={KeyWorkerPage} />
          <Route path={"/assurance"} component={AssurancePage} />
          <Route path={"/quality-reviews"} component={QualityReviewsPage} />
          <Route path={"/regulation-28"} component={Regulation28Page} />
          <Route path={"/care"} component={CareOperationsPage} />
          <Route path={"/safeguarding"} component={SafeguardingPage} />
          <Route path={"/rota-controls"} component={RotaControlsPage} />
          <Route path={"/search"} component={SearchPage} />
          <Route path={"/404"} component={NotFound} />
          <Route component={NotFound} />
            </Switch>
          </DashboardLayout>
        </Route>
      </Switch>
    </Suspense>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
