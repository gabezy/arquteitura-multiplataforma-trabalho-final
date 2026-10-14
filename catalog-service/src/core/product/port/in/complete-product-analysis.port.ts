export interface CompleteProductAnalysisPortInput {
    sku: string;
    status: 'APPROVED' | 'REJECTED';
}

export interface CompleteProductAnalysisPort {

    completeAnalysis(input: CompleteProductAnalysisPortInput): Promise<void>;

}